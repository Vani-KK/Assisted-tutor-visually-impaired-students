const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
require('dotenv').config();

class OpenAIRAGService {
  constructor() {
    this.documents = [];
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    // State tracking for voice commands
    this.lastReadContent = null;
    this.lastReadSource = null;
    this.currentNoteIndex = 0; // Track current position in notes list
    
    if (!process.env.OPENAI_API_KEY) {
      console.warn('Warning: OPENAI_API_KEY not found in environment variables');
    }
  }

  // Extract text from PDF
  async extractTextFromPDF(filePath) {
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      return data.text;
    } catch (error) {
      console.error('Error extracting text from PDF:', error);
      throw error;
    }
  }

  // Smart text chunking with overlap
  chunkText(text, chunkSize = 1000, overlap = 200) {
    const chunks = [];
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    let currentChunk = '';
    let currentChunkSentences = [];
    
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i].trim();
      if (!sentence) continue;
      
      const testChunk = currentChunk + (currentChunk ? '. ' : '') + sentence;
      
      if (testChunk.length > chunkSize && currentChunk.length > 0) {
        // Save current chunk
        chunks.push({
          text: currentChunk.trim() + '.',
          sentences: [...currentChunkSentences]
        });
        
        // Start new chunk with overlap
        const overlapSentences = currentChunkSentences.slice(-Math.ceil(overlap / 100));
        currentChunk = overlapSentences.join('. ') + (overlapSentences.length > 0 ? '. ' : '') + sentence;
        currentChunkSentences = [...overlapSentences, sentence];
      } else {
        currentChunk = testChunk;
        currentChunkSentences.push(sentence);
      }
    }
    
    // Add final chunk
    if (currentChunk.trim()) {
      chunks.push({
        text: currentChunk.trim() + '.',
        sentences: currentChunkSentences
      });
    }
    
    return chunks.map(chunk => chunk.text);
  }

  // Generate embeddings for text using OpenAI
  async generateEmbedding(text) {
    try {
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
        encoding_format: "float",
      });
      
      return response.data[0].embedding;
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw error;
    }
  }

  // Calculate cosine similarity between two vectors
  cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must have the same length');
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // Find similar documents using vector similarity
  async findSimilarDocuments(queryEmbedding, documents, limit = 3) {
    const results = [];
    
    for (const doc of documents) {
      if (!doc.embedding) continue;
      
      const similarity = this.cosineSimilarity(queryEmbedding, doc.embedding);
      results.push({
        ...doc,
        similarity: similarity
      });
    }
    
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  // Process and index documents with embeddings
  async processDocument(filePath, metadata = {}) {
    try {
      console.log('Processing document with OpenAI embeddings:', filePath);
      
      // Extract text from PDF
      const text = await this.extractTextFromPDF(filePath);
      
      if (!text || text.trim().length === 0) {
        throw new Error('No text content found in the document');
      }

      console.log(`Extracted ${text.length} characters from PDF`);

      // Split text into chunks
      const chunks = this.chunkText(text);
      console.log(`Created ${chunks.length} chunks`);

      // Generate embeddings for each chunk
      console.log('Generating embeddings for chunks...');
      const processedChunks = [];
      
      for (let i = 0; i < chunks.length; i++) {
        try {
          console.log(`Processing chunk ${i + 1}/${chunks.length}`);
          const embedding = await this.generateEmbedding(chunks[i]);
          
          processedChunks.push({
            text: chunks[i],
            embedding: embedding,
            metadata: {
              ...metadata,
              source: path.basename(filePath),
              timestamp: new Date().toISOString(),
              chunkIndex: i,
              chunkTotal: chunks.length
            }
          });
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`Error processing chunk ${i + 1}:`, error);
          // Continue with other chunks even if one fails
        }
      }

      // Add chunks to documents
      this.documents.push(...processedChunks);

      console.log(`Successfully processed ${processedChunks.length} chunks with embeddings from ${path.basename(filePath)}`);
      return { success: true, chunks: processedChunks.length };
    } catch (error) {
      console.error('Error processing document:', error);
      throw error;
    }
  }

  // Process all PDFs in uploads directory
  async processAllDocuments() {
    try {
      const uploadsDir = path.join(__dirname, 'uploads');
      const files = fs.readdirSync(uploadsDir);
      const pdfFiles = files.filter(file => file.toLowerCase().endsWith('.pdf'));
      
      console.log(`Found ${pdfFiles.length} PDF files to process with OpenAI`);
      
      for (const file of pdfFiles) {
        const filePath = path.join(uploadsDir, file);
        const metadata = {
          fileName: file,
          processedAt: new Date().toISOString(),
        };
        
        await this.processDocument(filePath, metadata);
      }
      
      return { success: true, processedFiles: pdfFiles.length };
    } catch (error) {
      console.error('Error processing all documents:', error);
      throw error;
    }
  }

  // Voice command parser - handles STT transcription variations
  parseVoiceCommand(question) {
    // Clean the input: remove punctuation, extra spaces, and convert to lowercase
    const cleaned = question.toLowerCase()
      .replace(/[.,!?;:]/g, '') // Remove common punctuation
      .replace(/\s+/g, ' ')     // Replace multiple spaces with single space
      .trim();
    
    // Start commands
    if (cleaned === 'start' || 
        cleaned.includes('start reading') ||
        cleaned === 'start reading') {
      return { type: 'start', command: 'start' };
    }
    
    // Repeat commands
    if (cleaned === 'repeat' || 
        cleaned.includes('repeat')) {
      return { type: 'repeat', command: 'repeat' };
    }
    
    // Next commands
    if (cleaned === 'next' || 
        cleaned.includes('next lesson') ||
        cleaned === 'next lesson') {
      return { type: 'next', command: 'next' };
    }
    
    // Stop commands
    if (cleaned === 'stop' || 
        cleaned.includes('stop reading') ||
        cleaned.includes('stop lesson') ||
        cleaned === 'stop reading' ||
        cleaned === 'stop lesson') {
      return { type: 'stop', command: 'stop' };
    }
    
    // Play lesson commands - handle various STT variations
    if (cleaned.includes('play lesson')) {
      // Convert word numbers to digits
      const wordToNumber = {
        'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
      };
      
      // Try different patterns for lesson numbers - prioritize "play lesson number X"
      const patterns = [
        /play lesson number (\d+)/,
        /play lesson number (one|two|three|four|five|six|seven|eight|nine|ten)/,
        /play lesson (\d+)/,
        /play lesson (one|two|three|four|five|six|seven|eight|nine|ten)/
      ];
      
      for (const pattern of patterns) {
        const match = cleaned.match(pattern);
        if (match) {
          let lessonNumber = match[1];
          
          // Convert word to number if needed
          if (wordToNumber[lessonNumber]) {
            lessonNumber = wordToNumber[lessonNumber];
          } else {
            lessonNumber = parseInt(lessonNumber);
          }
          
          return { 
            type: 'play_lesson', 
            command: 'play_lesson',
            lessonNumber: lessonNumber
          };
        }
      }
      
      // If no number found, return error
      return { 
        type: 'play_lesson', 
        command: 'play_lesson',
        lessonNumber: null 
      };
    }
    
    // List notes commands - handle STT variations
    if (cleaned.includes('list notes') || 
        cleaned.includes('show notes') || 
        cleaned.includes('what notes') ||
        cleaned.includes('available notes') ||
        cleaned === 'list' ||
        cleaned === 'notes' ||
        cleaned === 'list notes' ||
        cleaned === 'list nodes') { // Handle STT mishearing "notes" as "nodes"
      return { type: 'list_notes', command: 'list_notes' };
    }
    
    return null; // Not a voice command, treat as normal question
  }

  // Get list of available notes
  getAvailableNotes() {
    if (this.documents.length === 0) {
      return "No course materials are available. Please upload some PDF notes first.";
    }

    // Get unique documents (by source file)
    const uniqueSources = {};
    this.documents.forEach(doc => {
      const source = doc.metadata.source;
      if (!uniqueSources[source]) {
        uniqueSources[source] = {
          fileName: source,
          uploadDate: doc.metadata.timestamp,
          chunkCount: 0
        };
      }
      uniqueSources[source].chunkCount++;
    });

    const notesList = Object.values(uniqueSources);
    
    if (notesList.length === 0) {
      return "No course materials found.";
    }

    return notesList;
  }

  // Store last read content for repeat functionality
  storeLastReadContent(content, source) {
    this.lastReadContent = content;
    this.lastReadSource = source;
  }

  // Get complete PDF content for voice commands (not chunks)
  async getCompletePDFContentForVoiceCommand(commandType, lessonNumber = null) {
    try {
      // Get list of PDF files from uploads directory
      const uploadsDir = path.join(__dirname, 'uploads');
      const files = fs.readdirSync(uploadsDir);
      const pdfFiles = files.filter(file => file.toLowerCase().endsWith('.pdf'));
      
      if (pdfFiles.length === 0) {
        return "No course materials are available. Please upload some PDF notes first.";
      }

      // For 'start' - read the first PDF completely
      if (commandType === 'start') {
        this.currentNoteIndex = 0; // Reset to first PDF
        const firstPdf = pdfFiles[0];
        const filePath = path.join(uploadsDir, firstPdf);
        const fullText = await this.extractTextFromPDF(filePath);
        
        return {
          content: fullText,
          source: firstPdf,
          isCompletePDF: true
        };
      }

      // For 'play lesson X' - read the Xth PDF completely
      if (commandType === 'play_lesson' && lessonNumber) {
        const pdfIndex = Math.min(lessonNumber - 1, pdfFiles.length - 1);
        this.currentNoteIndex = pdfIndex; // Set current index to selected lesson
        const selectedPdf = pdfFiles[pdfIndex];
        const filePath = path.join(uploadsDir, selectedPdf);
        const fullText = await this.extractTextFromPDF(filePath);
        
        return {
          content: fullText,
          source: selectedPdf,
          isCompletePDF: true
        };
      }

      // For 'next' - read the next PDF in sequence
      if (commandType === 'next') {
        // Move to next PDF, wrap around if at end
        this.currentNoteIndex = (this.currentNoteIndex + 1) % pdfFiles.length;
        const selectedPdf = pdfFiles[this.currentNoteIndex];
        const filePath = path.join(uploadsDir, selectedPdf);
        const fullText = await this.extractTextFromPDF(filePath);
        
        return {
          content: fullText,
          source: selectedPdf,
          isCompletePDF: true
        };
      }

      // For 'repeat' - use the last read content if available
      if (commandType === 'repeat') {
        if (this.lastReadContent && this.lastReadSource) {
          return {
            content: this.lastReadContent,
            source: this.lastReadSource,
            isCompletePDF: true
          };
        } else {
          // If no previous content, read the current PDF
          const currentPdf = pdfFiles[this.currentNoteIndex];
          const filePath = path.join(uploadsDir, currentPdf);
          const fullText = await this.extractTextFromPDF(filePath);
          
          return {
            content: fullText,
            source: currentPdf,
            isCompletePDF: true
          };
        }
      }

      return null;
    } catch (error) {
      console.error('Error reading PDF content:', error);
      return "Error reading PDF content. Please try again.";
    }
  }

  // Handle voice commands with real content
  async handleVoiceCommand(command) {
    // Handle list notes command
    if (command.type === 'list_notes') {
      const notes = this.getAvailableNotes();
      
      if (typeof notes === 'string') {
        // Error message
        return {
          answer: notes,
          sources: [],
          confidence: 1.0,
          isVoiceCommand: true
        };
      }

      // Format the notes list
      const notesText = notes.map((note, index) => 
        `${index + 1}. ${note.fileName} (${note.chunkCount} sections)`
      ).join('\n');

      return {
        answer: `Available course materials:\n\n${notesText}\n\nYou can say "play lesson number [number]" to read specific content, or ask questions about any of these materials.`,
        sources: [],
        confidence: 1.0,
        isVoiceCommand: true
      };
    }

    // Handle stop command
    if (command.type === 'stop') {
      return {
        answer: "Stopping the current lesson. You can say 'start' to begin again, 'list notes' to see available materials, or ask me any questions about the course content.",
        sources: [],
        confidence: 1.0,
        isVoiceCommand: true
      };
    }

    const content = await this.getCompletePDFContentForVoiceCommand(command.type, command.lessonNumber);
    
    if (typeof content === 'string') {
      return {
        answer: content,
        sources: [],
        confidence: 1.0,
        isVoiceCommand: true
      };
    }

    // Handle case where content is null (e.g., invalid lesson number)
    if (!content) {
      return {
        answer: "I couldn't find the requested content. Please try a different command or ask a specific question.",
        sources: [],
        confidence: 1.0,
        isVoiceCommand: true
      };
    }

    // Store the content for repeat functionality (except for repeat and stop commands)
    if (command.type !== 'repeat' && command.type !== 'stop') {
      this.storeLastReadContent(content.content, content.source);
    }

    // Use full content for voice commands - no truncation
    const fullContent = content.content;

    switch(command.type) {
      case 'start':
        return {
          answer: `Starting the complete lesson content from ${content.source}:\n\n${fullContent}\n\nWhat would you like to know more about?`,
          sources: [{
            content: content.content.substring(0, 200) + '...',
            source: content.source,
            similarity: 1.0,
            isCompletePDF: true
          }],
          confidence: 1.0,
          isVoiceCommand: true
        };
        
      case 'repeat':
        return {
          answer: `Repeating the complete content from ${content.source}:\n\n${fullContent}\n\nIs there anything specific you'd like me to explain?`,
          sources: [{
            content: content.content.substring(0, 200) + '...',
            source: content.source,
            similarity: 1.0,
            isCompletePDF: true
          }],
          confidence: 1.0,
          isVoiceCommand: true
        };
        
      case 'next':
        return {
          answer: `Moving to the complete content from ${content.source}:\n\n${fullContent}\n\nWhat would you like to explore next?`,
          sources: [{
            content: content.content.substring(0, 200) + '...',
            source: content.source,
            similarity: 1.0,
            isCompletePDF: true
          }],
          confidence: 1.0,
          isVoiceCommand: true
        };
        
      case 'play_lesson':
        if (command.lessonNumber) {
          return {
            answer: `Playing complete lesson ${command.lessonNumber} content from ${content.source}:\n\n${fullContent}\n\nWhat specific aspect of this lesson would you like to discuss?`,
            sources: [{
              content: content.content.substring(0, 200) + '...',
              source: content.source,
              similarity: 1.0,
              isCompletePDF: true
            }],
            confidence: 1.0,
            isVoiceCommand: true
          };
        } else {
          return {
            answer: "I didn't catch the lesson number. Please say 'play lesson number' followed by the lesson number, like 'play lesson number 5'.",
            sources: [],
            confidence: 1.0,
            isVoiceCommand: true
          };
        }
        
      default:
        return null;
    }
  }

  // Query the RAG system using OpenAI
  async query(question, k = 3) {
    try {
      // First check if it's a voice command
      const voiceCommand = this.parseVoiceCommand(question);
      if (voiceCommand) {
        console.log('Voice command detected:', voiceCommand);
        return await this.handleVoiceCommand(voiceCommand);
      }

      // Otherwise, proceed with normal RAG query
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY in your .env file.');
      }

      if (this.documents.length === 0) {
        throw new Error('No documents have been processed yet. Please upload and process documents first.');
      }

      console.log(`Searching through ${this.documents.length} document chunks using OpenAI embeddings`);

      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(question);

      // Find similar documents using vector similarity
      const similarDocs = await this.findSimilarDocuments(queryEmbedding, this.documents, k);
      
      if (similarDocs.length === 0) {
        return {
          answer: "I couldn't find relevant information in the uploaded documents to answer your question. Try rephrasing your question or asking about different topics.",
          sources: [],
          confidence: 0
        };
      }

      // Prepare context from retrieved documents
      const context = similarDocs.map((doc, index) => 
        `Source ${index + 1} (from ${doc.metadata.source}):\n${doc.text}`
      ).join('\n\n');

      const sources = similarDocs.map((doc, index) => ({
        content: doc.text.substring(0, 200) + '...',
        source: doc.metadata.source,
        similarity: doc.similarity,
        chunkIndex: doc.metadata.chunkIndex
      }));

      console.log(`Found ${similarDocs.length} relevant chunks with similarities:`, 
        similarDocs.map(d => d.similarity.toFixed(3)));

      // Generate answer using OpenAI GPT
      const answer = await this.generateAnswer(question, context);
      
      return {
        answer: answer,
        sources: sources,
        confidence: similarDocs[0].similarity // Use highest similarity as confidence
      };
    } catch (error) {
      console.error('Error querying OpenAI RAG system:', error);
      throw error;
    }
  }

  // Generate answer using OpenAI GPT
  async generateAnswer(question, context) {
    try {
      const systemPrompt = `You are a helpful AI assistant that answers questions based on provided document content. 
      
Rules:
1. Only use information from the provided context to answer questions
2. If the context doesn't contain enough information to answer the question, say so clearly
3. Provide specific, accurate answers based on the document content
4. When possible, reference which source the information comes from
5. Be concise but comprehensive
6. If you're uncertain about something, express that uncertainty

Context from documents:
${context}`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: question
          }
        ],
        temperature: 0.1,
        max_tokens: 500
      });

      return response.choices[0].message.content;
    } catch (error) {
      console.error('Error generating answer with OpenAI:', error);
      throw error;
    }
  }

  // Save data to disk (including embeddings)
  async saveData() {
    try {
      const data = {
        documents: this.documents,
        timestamp: new Date().toISOString(),
        version: '2.0-openai'
      };
      
      fs.writeFileSync('./rag-data-openai.json', JSON.stringify(data, null, 2));
      console.log('OpenAI RAG data saved to disk');
    } catch (error) {
      console.error('Error saving OpenAI RAG data:', error);
    }
  }

  // Load data from disk (including embeddings)
  async loadData() {
    try {
      const openaiPath = './rag-data-openai.json';
      const legacyPath = './rag-data.json';
      
      // Try to load OpenAI version first
      if (fs.existsSync(openaiPath)) {
        const data = JSON.parse(fs.readFileSync(openaiPath, 'utf8'));
        this.documents = data.documents || [];
        console.log(`Loaded ${this.documents.length} documents with embeddings from disk`);
        return true;
      }
      
      // Check if legacy data exists but warn user
      if (fs.existsSync(legacyPath)) {
        console.log('Found legacy RAG data without embeddings. Documents will need to be reprocessed with OpenAI.');
        return false;
      }
      
      return false;
    } catch (error) {
      console.error('Error loading OpenAI RAG data:', error);
      return false;
    }
  }

  // Get system status
  getStatus() {
    return {
      documentsCount: this.documents.length,
      hasApiKey: !!process.env.OPENAI_API_KEY,
      version: '2.0-openai',
      ready: this.documents.length > 0 && !!process.env.OPENAI_API_KEY
    };
  }
}

module.exports = OpenAIRAGService;

