// routes/chat.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { createClient } = require('@deepgram/sdk');
// Remove the require('node-fetch') line
const Chat = require('../models/Chat');
const { OpenAI } = require('openai');
const { synthesizeSpeech } = require('../config/lmnt');

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Configure multer for handling audio files
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Initialize Deepgram client
const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);

// Get chat history for a user
router.get('/history/:userId', async (req, res) => {
  try {
    const chats = await Chat.find({ userId: req.params.userId })
      .sort({ updatedAt: -1 })
      .limit(10);
    res.json(chats);
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ message: error.message });
  }
});

// Send a message and get AI response
router.post('/message', async (req, res) => {
  try {
    const { userId, message } = req.body;

    let chat = await Chat.findOne({ userId });
    if (!chat) {
      chat = new Chat({ userId, messages: [] });
    }

    chat.messages.push({
      content: message,
      isUser: true,
      timestamp: new Date()
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: message }
      ],
      max_tokens: 500
    });

    const aiResponse = completion.choices[0].message.content;

    chat.messages.push({
      content: aiResponse,
      isUser: false,
      timestamp: new Date()
    });

    chat.updatedAt = Date.now();
    await chat.save();

    res.json({
      message: aiResponse,
      chatHistory: chat.messages
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ message: error.message });
  }
});

// routes/chat.js - update the synthesize route

router.post('/synthesize', async (req, res) => {
  try {
    const { 
      text, 
      voice = 'lily',
      language = 'en',
      model = 'aurora',
      format = 'wav',
      conversational = false,
      sample_rate = 24000,
      speed = 1
    } = req.body;
    
    if (!process.env.LMNT_API_KEY) {
      return res.status(500).json({ error: 'LMNT API key not configured' });
    }

    if (!text) {
      return res.status(400).json({ error: 'No text provided for synthesis' });
    }

    if (text.length > 5000) {
      return res.status(400).json({ error: 'Text exceeds maximum length of 5000 characters' });
    }

    console.log('Attempting speech synthesis:', {
      textLength: text.length,
      voice,
      language,
      model,
      format,
      conversational,
      sample_rate,
      speed
    });

    const { audioData, metadata } = await synthesizeSpeech(text, {
      voice,
      language,
      model,
      format,
      conversational,
      sample_rate,
      speed
    });

    // Map format to content type
    const contentTypes = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      aac: 'audio/aac',
      mulaw: 'audio/basic',
      raw: 'audio/raw'
    };

    // Set response headers
    res.set({
      'Content-Type': contentTypes[format] || metadata.contentType,
      'Content-Length': audioData.length,
      'X-Sample-Rate': metadata.sampleRate,
      'X-Duration-Samples': metadata.durationSamples,
      'Cache-Control': 'no-cache'
    });

    return res.send(audioData);
  } catch (error) {
    console.error('Text-to-speech error:', error);
    
    const errorMessage = error.message || 'Failed to synthesize speech';
    const statusCode = error.response?.status || 500;
    
    res.status(statusCode).json({ 
      error: errorMessage
    });
  }
});

// Transcribe audio using Deepgram
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    console.log('Received audio file:', {
      mimetype: req.file.mimetype,
      size: req.file.size,
      originalname: req.file.originalname
    });

    if (req.file.size === 0) {
      return res.status(400).json({ error: 'Empty audio file received' });
    }

    const { buffer } = req.file;

    const { result, error } = await deepgramClient.listen.prerecorded.transcribeFile(
      buffer,
      {
        mimetype: 'audio/webm',
        options: {
          smart_format: true,
          model: 'general',
          language: 'en-US'
        }
      }
    );

    if (error) {
      console.error('Deepgram API error:', error);
      return res.status(500).json({ error: 'Transcription service error' });
    }

    const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;

    if (!transcript) {
      return res.status(500).json({ error: 'No transcript received from service' });
    }

    res.json({ transcript });
  } catch (error) {
    console.error('Server error during transcription:', error);
    res.status(500).json({ error: 'Server error during transcription' });
  }
});

// Delete chat history
router.delete('/history/:userId', async (req, res) => {
  try {
    await Chat.deleteMany({ userId: req.params.userId });
    res.json({ message: 'Chat history deleted successfully' });
  } catch (error) {
    console.error('Error deleting chat history:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;