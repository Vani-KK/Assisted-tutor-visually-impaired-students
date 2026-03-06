import React, { useState, useRef, useEffect } from 'react';
import AudioRecorder from './AudioRecorder';
import AudioWaveform from './AudioWaveform';

function ChatInterface() {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showWaveform, setShowWaveform] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const messagesEndRef = useRef(null);
  const [voicesLoaded, setVoicesLoaded] = useState(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load voices for Web Speech API
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        setVoicesLoaded(true);
        console.log('Available voices:', voices.map(v => v.name));
      }
    };

    // Load voices immediately if available
    loadVoices();

    // Some browsers need this event listener
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  // Auto-play TTS for new bot messages using Web Speech API
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    
    // Only auto-play for bot messages that aren't errors
    if (lastMessage && lastMessage.sender === 'bot' && !lastMessage.isError && lastMessage.text) {
      // Small delay to ensure message is rendered
      setTimeout(() => {
        playTTS(lastMessage.text);
      }, 100);
    }
  }, [messages]);

  const playTTS = (text) => {
    try {
      // Check if browser supports Web Speech API
      if (!('speechSynthesis' in window)) {
        console.warn('Web Speech API not supported in this browser');
        return;
      }

      // Filter out file names from TTS to make it more natural
      const filteredText = text.replace(/\.pdf/gi, '')
                              .replace(/from [^:]+\.pdf/gi, 'from the document')
                              .replace(/content from [^:]+\.pdf/gi, 'content from the document')
                              .replace(/lesson content from [^:]+\.pdf/gi, 'lesson content')
                              .replace(/complete content from [^:]+\.pdf/gi, 'complete content')
                              .replace(/Starting the complete lesson content from [^:]+/gi, 'Starting the complete lesson content')
                              .replace(/Repeating the complete content from [^:]+/gi, 'Repeating the complete content')
                              .replace(/Moving to the complete content from [^:]+/gi, 'Moving to the complete content')
                              .replace(/Playing complete lesson \d+ content from [^:]+/gi, 'Playing complete lesson content');

      // Cancel any ongoing speech
      window.speechSynthesis.cancel();

      // Small delay after cancel to avoid issues
      setTimeout(() => {
        // Create speech utterance
        const utterance = new SpeechSynthesisUtterance(filteredText);
        
        // Configure voice settings
        utterance.rate = 1.0;    // Speed (0.1 to 10)
        utterance.pitch = 1.0;   // Pitch (0 to 2)
        utterance.volume = 1.0;  // Volume (0 to 1)
        utterance.lang = 'en-US';
        
        // Get voices and select preferred one
        const voices = window.speechSynthesis.getVoices();
        console.log('Speaking with', voices.length, 'voices available');
        
        const preferredVoice = voices.find(voice => 
          voice.lang.includes('en-US') && (voice.name.includes('Female') || voice.name.includes('Samantha'))
        ) || voices.find(voice => 
          voice.lang.includes('en-US')
        ) || voices.find(voice => 
          voice.lang.includes('en')
        );
        
        if (preferredVoice) {
          utterance.voice = preferredVoice;
          console.log('Using voice:', preferredVoice.name);
        }

        // Add event listeners for debugging
        utterance.onstart = () => console.log('Speech started');
        utterance.onend = () => console.log('Speech ended');
        utterance.onerror = (e) => console.error('Speech error:', e);

      // Speak the text
      window.speechSynthesis.speak(utterance);
      console.log('Speaking:', filteredText.substring(0, 50) + '...');
      }, 100);
    } catch (error) {
      console.error('TTS error:', error);
    }
  };

  const sendMessage = async (messageText) => {
    if (!messageText.trim() || isLoading) return;

    const userMessage = {
      id: Date.now(),
      text: messageText,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:3001/api/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: messageText }),
      });

      const data = await response.json();

      if (response.ok) {
        const botMessage = {
          id: Date.now() + 1,
          text: data.answer,
          sender: 'bot',
          timestamp: new Date().toLocaleTimeString(),
          sources: data.sources || [],
          confidence: data.confidence || 0
        };

        setMessages(prev => [...prev, botMessage]);
      } else {
        const errorMessage = {
          id: Date.now() + 1,
          text: `Error: ${data.message || 'Failed to get response'}`,
          sender: 'bot',
          timestamp: new Date().toLocaleTimeString(),
          isError: true
        };

        setMessages(prev => [...prev, errorMessage]);
      }
    } catch (error) {
      const errorMessage = {
        id: Date.now() + 1,
        text: `Error: ${error.message}`,
        sender: 'bot',
        timestamp: new Date().toLocaleTimeString(),
        isError: true
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  const handleTranscription = (transcription, confidence) => {
    setShowWaveform(false);
    
    // Automatically send the transcribed message without showing transcription details
    sendMessage(transcription);
  };

  const handleTranscriptionError = (error) => {
    setShowWaveform(false);
    const errorMessage = {
      id: Date.now(),
      text: `🎤 Error: ${error}`,
      sender: 'system',
      timestamp: new Date().toLocaleTimeString(),
      isError: true,
      isSystem: true
    };
    
    setMessages(prev => [...prev, errorMessage]);
  };

  const handleRecordingStart = () => {
    setShowWaveform(true);
  };

  const handleRecordingStop = () => {
    setShowWaveform(false);
  };

  const handleAudioLevelChange = (level) => {
    setAudioLevel(level);
  };

  return (
    <div className="chat-interface">
      <div className="chat-header">
        <h3>Ask Questions About Course Materials</h3>
        <button onClick={clearChat} className="clear-btn">
          Clear Chat
        </button>
      </div>
      
      <div className="chat-messages">
        {messages.map((message) => (
            <div key={message.id} className={`message ${message.sender} ${message.isSystem ? 'system' : ''}`}>
              <div className="message-content">
                <div className="message-text">{message.text}</div>
                {message.sources && message.sources.length > 0 && (
                  <div className="message-sources">
                    <details>
                      <summary>Sources ({message.sources.length})</summary>
                      {message.sources.map((source, index) => (
                        <div key={index} className="source-item">
                          <strong>Source {index + 1}:</strong> {source.source}
                          {source.similarity && (
                            <div className="similarity-score">
                              Relevance: {Math.round(source.similarity * 100)}%
                            </div>
                          )}
                          <div className="source-content">{source.content}</div>
                        </div>
                      ))}
                    </details>
                  </div>
                )}
                {message.confidence && (
                  <div className="confidence">
                    Confidence: {Math.round(message.confidence * 100)}%
                  </div>
                )}
                <div className="message-timestamp">{message.timestamp}</div>
              </div>
            </div>
          ))}
        {isLoading && (
          <div className="message bot">
            <div className="message-content">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      
      <div className="chat-input">
        <AudioRecorder 
          onTranscription={handleTranscription}
          onError={handleTranscriptionError}
          onRecordingStart={handleRecordingStart}
          onRecordingStop={handleRecordingStop}
          onAudioLevelChange={handleAudioLevelChange}
          disabled={isLoading}
        />
        {showWaveform && (
          <AudioWaveform 
            audioLevel={audioLevel}
            isRecording={true}
          />
        )}
      </div>
    </div>
  );
}

export default ChatInterface;
