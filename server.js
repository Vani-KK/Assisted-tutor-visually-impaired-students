const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
require('dotenv').config();
const OpenAIRAGService = require('./openaiRagService');
const speech = require('@google-cloud/speech');

const app = express();
const PORT = 3001;

// Initialize OpenAI RAG service
const ragService = new OpenAIRAGService();

// Initialize Google Speech-to-Text client
const speechClient = new speech.SpeechClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
});

// Load existing data on startup
ragService.loadData().then(loaded => {
  if (!loaded) {
    console.log('No existing RAG data found. Will process documents on first query.');
  }
});

// Enable CORS
app.use(cors());
app.use(express.json({ limit: '50mb' }));  // Support large audio files
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Use original filename as-is
    cb(null, file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Upload endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileInfo = {
      originalName: req.file.originalname,
      fileName: req.file.filename,
      filePath: req.file.path,
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    };

    console.log('File uploaded:', fileInfo);
    
    // Process PDF files for RAG
    if (req.file.mimetype === 'application/pdf') {
      try {
        await ragService.processDocument(req.file.path, {
          originalName: req.file.originalname,
          fileName: req.file.filename,
          uploadDate: new Date().toISOString()
        });
        await ragService.saveData();
        console.log('Document processed for RAG:', req.file.originalname);
      } catch (ragError) {
        console.error('RAG processing error:', ragError);
        // Don't fail the upload if RAG processing fails
      }
    }
    
    res.json(fileInfo);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Download endpoint
app.get('/api/download/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(uploadsDir, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Check if it's a PDF file for inline viewing
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
    } else {
      // For other file types, force download
      res.setHeader('Content-Disposition', 'attachment');
    }
    
    res.sendFile(filePath);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

// Delete endpoint
app.delete('/api/delete/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(uploadsDir, filename);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('File deleted:', filename);
      res.json({ message: 'File deleted successfully' });
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// RAG Query endpoint
app.post('/api/query', async (req, res) => {
  try {
    const { question } = req.body;
    
    if (!question || question.trim().length === 0) {
      return res.status(400).json({ error: 'Question is required' });
    }

    console.log('RAG Query received:', question);
    
    // Process all documents if no documents loaded
    if (ragService.documents.length === 0) {
      console.log('Processing all documents for RAG...');
      await ragService.processAllDocuments();
      await ragService.saveData();
    }

    const result = await ragService.query(question);
    res.json(result);
  } catch (error) {
    console.error('RAG Query error:', error);
    res.status(500).json({ 
      error: 'Query failed', 
      message: error.message 
    });
  }
});

// Process all documents endpoint
app.post('/api/process-documents', async (req, res) => {
  try {
    console.log('Processing all documents for RAG...');
    const result = await ragService.processAllDocuments();
    await ragService.saveData();
    res.json(result);
  } catch (error) {
    console.error('Document processing error:', error);
    res.status(500).json({ 
      error: 'Document processing failed', 
      message: error.message 
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date().toISOString() });
});

// RAG system status endpoint
app.get('/api/rag-status', (req, res) => {
  try {
    const status = ragService.getStatus();
    res.json(status);
  } catch (error) {
    console.error('Error getting RAG status:', error);
    res.status(500).json({ error: 'Failed to get RAG status' });
  }
});

// Speech-to-Text endpoint
app.post('/api/speech-to-text', async (req, res) => {
  try {
    const { audioData, mimeType = 'audio/webm' } = req.body;
    
    if (!audioData) {
      return res.status(400).json({ error: 'Audio data is required' });
    }

    // Convert base64 audio data to buffer
    const audioBuffer = Buffer.from(audioData, 'base64');

    // Configure the request
    const request = {
      audio: {
        content: audioBuffer.toString('base64'),
      },
      config: {
        encoding: mimeType.includes('webm') ? 'WEBM_OPUS' : 'LINEAR16',
        sampleRateHertz: 48000,
        languageCode: 'en-US',
        enableAutomaticPunctuation: true,
        model: 'latest_long',
      },
    };

    // Perform the transcription
    const [response] = await speechClient.recognize(request);
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');

    console.log('Speech-to-Text result:', transcription);
    
    res.json({ 
      transcription: transcription,
      confidence: response.results[0]?.alternatives[0]?.confidence || 0
    });
  } catch (error) {
    console.error('Speech-to-Text error:', error);
    res.status(500).json({ 
      error: 'Speech-to-Text failed', 
      message: error.message 
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`File server running on port ${PORT}`);
  console.log(`Uploads directory: ${uploadsDir}`);
});
