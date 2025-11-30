// src/chatbot.js - Enhanced with tabs, responsive design, and new features
import './chatbot.css';
import { parseMarkdown, generateUniqueId, setLocalStorageItem, getLocalStorageItem } from './utils';
import { renderMessage, renderCustomPayload } from './renderer';
import endpoints from './api/endpoints';
import {
  LocalParticipant,
  LocalTrackPublication,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
} from 'livekit-client';




let authToken = null;
let is_first_log_in = true;

class ChatbotWidget {
  constructor() {
    this.config = {};
    this.isOpen = false;
    this.sessionId = null;
    this.messages = [];
    this.elements = {};
    this.refreshInterval = null;
    this.debug = true;
    this.currentTab = 'home';
    this.termsAccepted = false;
    this.announcements = [];
    this.userNotifications = [];
    this.notifications = [
      "👋 !مرحباً، يمكنني مساعدتك",
      "🛍️ هل تريد استكشاف منتجاتنا الجديدة؟",
      "🤔 هل تحتاج مساعدة في أي شيء؟",
      "💬 !أنا هنا إذا كان لديك أسئلة",
      "🔥 !اطلع على أحدث عروضنا"
    ];
  }
  async init() {
    this.initConfig();
    await this.loadConfig();
    this.initSession();
    
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      this.createWidgetUI();
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        console.log('DOM fully loaded, creating UI');
        this.createWidgetUI();
      });
    }
    
    // Fallback timeout
    setTimeout(() => {
      if (!this.elements.container) {
        console.warn('Fallback UI creation');
        this.createWidgetUI();
      }
    }, 1000);

    // Load announcements
    console.log('Loading announcements...');
    await this.loadAnnouncements();
  }


//--------




    //---------------------------- Configuration & Initialization ----------------------------//
    // give the Configuration initial values from script tag and API
  initConfig(apiConfig = {}) {
    const scriptTag = document.querySelector('script[src*="chatbot.bundle.js"]');
    let scriptConfig = {};

    if (scriptTag) {
      const configJson = scriptTag.getAttribute('chatbot-config');
      if (configJson) {
        try {
          scriptConfig = JSON.parse(configJson);
        } catch (e) {
          console.error('Chatbot SDK: Invalid JSON in chatbot-config attribute', e);
        }
      }
    }

    this.config = {
      ...scriptConfig,
      ...apiConfig
    };

    // Apply defaults if not set
    this.config.botUrl = endpoints.chatbot.chat;
    this.config.startingUrl = endpoints.chatbot.start; // New endpoint for starting messages
    this.config.announcementsUrl = endpoints.chatbot.news;
    this.config.themeColor = this.config.themeColor || '#020c15ff';
    //console.log('Theme color set to:', this.config.themeColor);
    this.config.position = this.config.position || 'bottom-right';
    this.config.botName = this.config.botName || 'Chatbot';
    console.log('botName:', this.config.botName);
    this.config.inputPlaceholder = this.config.inputPlaceholder || 'Type your message...';
    this.config.sendButtonText = this.config.sendButtonText || 'Send';
  }
  // Call API to get dynamic config and merge from the backend
  async loadConfig() {
    if (endpoints.chatbot.config) {
      try {
        this.log('Loading initial config from API');
        const response = await fetch(`${endpoints.chatbot.config}?t=${Date.now()}`);
        const apiConfig = await response.json();
        this.mergeConfigs(apiConfig);
        this.applyDynamicStyles();
      } catch (error) {
        this.log('Initial config load failed:', error);
      }
    }
  }
  // merge old config with new config from API and override old values 
  mergeConfigs(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig,
      style: {
        ...(this.config.style || {}),
        ...(newConfig.style || {})
      },
      features: {
        ...(this.config.features || {}),
        ...(newConfig.features || {})
      }
    };
    this.log('Merged config:', this.config);
  }
  // --- Dynamic Configuration ---
  applyDynamicStyles() {
    if (!this.config.style) {
      this.log('No style configuration found');
      return;
    }

    const root = document.documentElement;
    const { style } = this.config;

    if (style.themeColor) {
    console.log('Applying theme color:', style.themeColor);
      root.style.setProperty('--chatbot-theme-color', style.themeColor);
      root.style.setProperty('--chatbot-theme-color-hover', this.adjustColor(style.themeColor, -20));
    }

    if (style.header?.backgroundColor) {
        console.log('Applying theme color:', style.backgroundColor);
      root.style.setProperty('--chatbot-header-bg', style.header.backgroundColor);
    }

    if (style.header?.textColor) {
      root.style.setProperty('--chatbot-header-text', style.header.textColor);
    }

    if (style.bubble?.color) {
      root.style.setProperty('--chatbot-bubble-color', style.bubble.color);
    }

    if (style.messages?.userBubbleColor) {
      root.style.setProperty('--chatbot-user-bubble', style.messages.userBubbleColor);
    }

    if (style.messages?.botBubbleColor) {
      root.style.setProperty('--chatbot-bot-bubble', style.messages.botBubbleColor);
    }
  }

  async refreshConfig() {
    try {
      this.log('Refreshing configuration...');
      const response = await fetch(`${this.config.configApiUrl}?t=${Date.now()}`);
      const newConfig = await response.json();
      this.mergeConfigs(newConfig);
      this.applyDynamicStyles();
      this.updateUIElements();
      this.log('Configuration refreshed successfully');
      return true;
    } catch (error) {
      this.log('Failed to refresh config:', error);
      return false;
    }
  }

//------------------------------------------------------------------------//

    // --- Session Management ---
  initSession() {
    this.sessionId = getLocalStorageItem('chatbot_session_id');
    if (!this.sessionId) {
      this.sessionId = generateUniqueId();
      setLocalStorageItem('chatbot_session_id', this.sessionId);
    }
    this.messages = getLocalStorageItem(`chatbot_conversation_${this.sessionId}`) || [];
  }

  startMessageCycle() {
    // CLEAR ANY EXISTING INTERVAL FIRST
    if (this.messageInterval) {
      clearInterval(this.messageInterval);
      this.messageInterval = null;
    }
    
    if (this.isOpen) return;
    
    // Reset index to start from beginning
    this.currentMessageIndex = 0;
    
    // Show first message immediately
    this.showNextMessage();
    
    // Set interval to show next message every 5 seconds
    this.messageInterval = setInterval(() => {
      if (!this.isOpen) {
        this.showNextMessage();
      } else {
        // If chat opened, stop the interval
        this.stopMessageCycle();
      }
    }, 5000);
  }

  showNextMessage() {
    if (!this.elements.messageBubble) return;
    
    // Hide current message with animation
    this.elements.messageBubble.style.opacity = '0';
    this.elements.messageBubble.style.transform = 'translateY(-50%) translateX(20px) scale(0.8)';
    
    setTimeout(() => {
      // Update message text
      this.elements.messageBubble.innerHTML = `
        <span>${this.notifications[this.currentMessageIndex]}</span>
        <div style="position: absolute; top: 50%; right: -8px; transform: translateY(-50%); width: 0; height: 0; border-left: 8px solid white; border-top: 8px solid transparent; border-bottom: 8px solid transparent;"></div>
      `;
      
      // Show message with animation
      this.elements.messageBubble.style.opacity = '1';
      this.elements.messageBubble.style.transform = 'translateY(-50%) translateX(0) scale(1)';
      
      // Move to next message for the NEXT call
      this.currentMessageIndex = (this.currentMessageIndex + 1) % this.notifications.length;
      
      // Debug: Log current message index
      console.log('Showing message:', this.currentMessageIndex - 1 < 0 ? this.notifications.length - 1 : this.currentMessageIndex - 1);
      
    }, 400);
  }

  stopMessageCycle() {
    if (this.messageInterval) {
      clearInterval(this.messageInterval);
      this.messageInterval = null;
    }
    
    // Hide current message
    if (this.elements.messageBubble) {
      this.elements.messageBubble.style.opacity = '0';
      this.elements.messageBubble.style.transform = 'translateY(-50%) translateX(20px) scale(0.8)';
    }
  }

  log(...args) {
    if (this.debug) console.log('[Chatbot]', ...args);
  }





  // --- Announcements Management ---
  async loadAnnouncements() {
    try {
      const response = await fetch(this.config.announcementsUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const announcements = await response.json();
        this.announcements = announcements.sort((a, b) => new Date(b.date) - new Date(a.date));
        this.renderAnnouncements();
      }
    } catch (error) {
      console.error('Failed to load announcements:', error);
    }
  }

  renderAnnouncements() {
  const announcementsContent = this.elements.announcementsContent;
  if (!announcementsContent) return;

  const container = announcementsContent.querySelector('.chatbot-announcements-list');
  if (!container) return;

  container.innerHTML = '';
  // Add a class for the specific scroll effect
  container.classList.add('scroll-stack-list');

  if (this.announcements.length === 0) {
    container.innerHTML = `
      <div class="chatbot-announcements-empty">
        <div class="chatbot-announcements-empty-icon">📢</div>
        <p>No announcements available at the moment.</p>
      </div>
    `;
    return;
  }

  this.announcements.forEach((announcement, index) => {
    const card = document.createElement('div');
    card.className = 'chatbot-announcement-card';
    card.style.animationDelay = `${index * 0.1}s`;

    const imageSection = announcement.image 
      ? `<div class="chatbot-announcement-image" style="background-image: url('${announcement.image}')"></div>`
      : `<div class="chatbot-announcement-image chatbot-announcement-default-icon">📢</div>`;

    card.innerHTML = `
    
      ${imageSection}
      <div class="chatbot-announcement-content">
        <div class="chatbot-announcement-title">${announcement.text || 'Announcement'}</div>
        <div class="chatbot-announcement-description">${announcement.description || ''}</div>
        <div class="chatbot-announcement-date">${this.formatDate(announcement.date)}</div>
      </div>
    `;

    container.appendChild(card);
  });
}
  formatDate(dateString) {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch (error) {
      return dateString;
    }
  }



  adjustColor(color, amount) {
    return '#' + color.replace(/^#/, '').replace(/../g, colorHex => 
      ('0' + Math.min(255, Math.max(0, parseInt(colorHex, 16) + amount)).toString(16)).slice(-6));
  }

  async getVoiceToken(identity, name) {
    try {
      const response = await fetch(endpoints.chatbot.voice_agent_token, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ identity, name })
      });

      if (response.ok) {
        const { room, token } = await response.json();
        return { room, token };
      } else {
        console.error("Server returned an error:", response.status);
        return null;
      }
    } catch (error) {
      console.error("Failed to load user token:", error);
      return null;
    }
  }
  
  // --- UI Management ---
async createWidgetUI() {
  console.log('Creating widget UI...');
  console.log('Config:', this.config);
 
  const container = document.createElement('div');
  container.id = 'chatbot-widget-container';
  console.log('Container created:', container);

  container.classList.add(`chatbot-position-${this.config.position}`);
  container.style.display = 'none';
  container.style.opacity = '0';

  document.body.appendChild(container);
  this.elements.container = container;

  // Voice call state management
  this.voiceCallState = {
    room: null,
    isConnected: false,
    isConnecting: false,
    localParticipant: null,
    audioContext: null,
    oscillator: null,
    selectedLanguage: 'en' 
  };

  // Create loading sound using Web Audio API
this.createLoadingSound = () => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A4 tone (pleasant mid pitch)

  const ringDuration = 1.2; // seconds for each ring tone
  const silenceDuration = 2.0; // seconds of silence between rings
  const totalDuration = ringDuration + silenceDuration;

  const scheduleRing = () => {
    if (!this.voiceCallState.isConnecting) return;

    const now = audioContext.currentTime;

    // Smooth fade-in and fade-out for luxury effect
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.4, now + 0.1); // fade in
    gainNode.gain.linearRampToValueAtTime(0.4, now + ringDuration - 0.2);
    gainNode.gain.linearRampToValueAtTime(0, now + ringDuration); // fade out

    // Loop again
    setTimeout(scheduleRing, totalDuration * 1000);
  };

  scheduleRing();
  oscillator.start();

  return { audioContext, oscillator, gainNode };
};


  // Stop loading sound
  this.stopLoadingSound = (soundObjects) => {
    if (soundObjects) {
      soundObjects.oscillator.stop();
      soundObjects.audioContext.close();
    }
  };

  // Initialize LiveKit Room
  this.initializeVoiceCall = async () => {
    if (this.voiceCallState.room) return;

    const handleTrackSubscribed = (track, publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const element = track.attach();
          element.autoplay = true;
          console.log('Track subscribed:', track.kind, participant.identity);
          container.appendChild(element);
          
          // Stop loading sound when agent's audio track is received
          if (this.voiceCallState.loadingSoundObjects && participant.identity !== 'user1') {
            this.stopLoadingSound(this.voiceCallState.loadingSoundObjects);
            this.voiceCallState.loadingSoundObjects = null;
            this.voiceCallState.isConnecting = false;
            this.updateCallButton();
          }
        }
        
        if (track.kind === Track.Kind.Video) {
          const element = track.attach();
          element.autoplay = true;
          console.log('Video track subscribed:', participant.identity);
          container.appendChild(element);
        }
      };

    function handleTrackUnsubscribed(track) {
      track.detach();
    }

    function handleLocalTrackUnpublished(publication) {
      publication.track.detach();
    }

    function handleActiveSpeakerChange(speakers) {
      // UI indicators when participant is speaking
    }

    const handleDisconnect = () => {
      console.log('disconnected from room');
      this.voiceCallState.isConnected = false;
      this.voiceCallState.isConnecting = false;
      this.updateCallButton();
    };

    const token = await this.getVoiceToken('user1', 'Hazem');
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });

    room
      .on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
      .on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
      .on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakerChange)
      .on(RoomEvent.Disconnected, handleDisconnect)
      .on(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);

    this.voiceCallState.room = room;
    return room;
  };
  // Start voice call
  this.startVoiceCall = async () => {
    if (this.voiceCallState.isConnected || this.voiceCallState.isConnecting) return;

    this.voiceCallState.isConnecting = true;
    this.updateCallButton();

    // Start loading sound and store reference
    const soundObjects = this.createLoadingSound();
    this.voiceCallState.loadingSoundObjects = soundObjects;

    try {
      if (!this.voiceCallState.room) {
        console.log('Initializing voice call room...');
        await this.initializeVoiceCall();
      }
      let { room, token } = await this.getVoiceToken("user1", "Hazem");
      
      await this.voiceCallState.room.connect('wss://finovax.duckdns.org', token);
      console.log('Connected to room', this.voiceCallState.room.name);
      console.log('language selected:', this.voiceCallState.selectedLanguage);
      await fetch(endpoints.chatbot.start_agent, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          room_name: room,
          language: this.voiceCallState.selectedLanguage
        })
      });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioTrack = stream.getAudioTracks()[0];

      this.voiceCallState.localParticipant = this.voiceCallState.room.localParticipant;
      const pub = await this.voiceCallState.localParticipant.publishTrack(audioTrack, {
        name: 'microphone',
        source: Track.Source.Microphone,
      });

      console.log('Microphone published:', pub);
      this.voiceCallState.isConnected = true;
        


      } catch (err) {
        console.error('Error starting voice call:', err);
        this.stopLoadingSound(soundObjects);
        this.voiceCallState.loadingSoundObjects = null;
        this.voiceCallState.isConnecting = false;
        this.updateCallButton();
        alert('Failed to start call. Please check your microphone permissions.');
      }
    };

  // End voice call
  this.endVoiceCall = async () => {
    if (!this.voiceCallState.room || !this.voiceCallState.isConnected) return;

    try {
      // Disconnect from room
      await this.voiceCallState.room.disconnect();
      this.voiceCallState.isConnected = false;
      this.voiceCallState.isConnecting = false;
      this.voiceCallState.room = null;
      this.voiceCallState.localParticipant = null;
      this.updateCallButton();
      console.log('Voice call ended');
    } catch (err) {
      console.error('Error ending voice call:', err);
    }
  };

  // Update call button appearance
  this.updateCallButton = () => {
    const callButton = document.querySelector('.chatbot-action-card[data-action="voice-call"]');
    const callIcon = callButton?.querySelector('.chatbot-action-icon');
    const callTitle = callButton?.querySelector('.chatbot-action-title');
    const callDesc = callButton?.querySelector('.chatbot-action-desc');

    if (!callButton) return;

    if (this.voiceCallState.isConnecting) {
      callButton.style.background = 'linear-gradient(135deg, #FFA726 0%, #FB8C00 100%)';
      callButton.style.animation = 'pulse 1.5s infinite';
      callIcon.textContent = '⏳';
      callTitle.textContent = 'Connecting...';
      callDesc.textContent = 'Please wait while we connect you';
    } else if (this.voiceCallState.isConnected) {
      callButton.style.background = 'linear-gradient(135deg, #EF5350 0%, #E53935 100%)';
      callButton.style.animation = 'none';
      callIcon.textContent = '📞';
      callTitle.textContent = 'End Call';
      callDesc.textContent = 'Tap to disconnect the call';
    } else {
      callButton.style.background = '';
      callButton.style.animation = 'none';
      callIcon.textContent = '📞';
      callTitle.textContent = 'Call Us';
      callDesc.textContent = 'Start a voice conversation with us';
    }
  };

  setTimeout(() => {
    const computedStyle = window.getComputedStyle(this.elements.container);
    console.log('Computed styles:', {
      display: computedStyle.display,
      opacity: computedStyle.opacity,
      zIndex: computedStyle.zIndex,
      visibility: computedStyle.visibility
    });
  }, 500);

  // Apply animation settings
  const animation = this.config.style?.animation || { type: 'fade-in', duration: 300 };
  if (animation.type) {
    container.style.transition = `all ${animation.duration}ms ease`;
  }

  // Create Chat Bubble
  const bubble = document.createElement('div');
  bubble.className = 'chatbot-bubble';
  const bubbleStyle = this.config.style?.bubble || {};
  bubble.style.width = bubbleStyle.size || '60px';
  bubble.style.height = bubbleStyle.size || '60px';
  bubble.style.backgroundColor = bubbleStyle.color || 'var(--chatbot-theme-color)';
  
  if (bubbleStyle.icon) {
    bubble.innerHTML = bubbleStyle.icon.startsWith('http') ? 
      `<img src="${bubbleStyle.icon}" alt="Chat" style="width: 70%; height: 70%;">` : 
      bubbleStyle.icon;
  } else {
    bubble.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
      </svg>
    `;
  }
  
  const messageBubble = document.createElement('div');
  messageBubble.className = 'chatbot-message';
  messageBubble.style.cssText = `
    position: absolute;
    right: 90px;
    top: 50%;
    transform: translateY(-50%) translateX(20px) scale(0.8);
    background: white;
    padding: 12px 16px;
    border-radius: 20px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    max-width: 250px;
    opacity: 0;
    transition: all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    font-size: 14px;
    color: #333;
    border: 1px solid #e0e0e0;
    white-space: nowrap;
    pointer-events: none;
    z-index: 999;
  `;

  messageBubble.innerHTML = '<div style="position: absolute; top: 50%; right: -8px; transform: translateY(-50%); width: 0; height: 0; border-left: 8px solid white; border-top: 8px solid transparent; border-bottom: 8px solid transparent;"></div>';

  bubble.addEventListener('click', () => this.toggleChatWindow());

  container.appendChild(messageBubble);
  container.appendChild(bubble);

  this.elements.bubble = bubble;
  this.elements.messageBubble = messageBubble;

  setTimeout(() => this.startMessageCycle(), 3000);

  // Create Chat Window with tabs
  const windowEl = document.createElement('div');
  windowEl.className = 'chatbot-window';
  
  const headerStyle = this.config.style?.header || {};
  windowEl.innerHTML = `
    <style>
      @keyframes pulse {
        0%, 100% { transform: scale(1); box-shadow: 0 4px 15px rgba(255, 167, 38, 0.3); }
        50% { transform: scale(1.05); box-shadow: 0 6px 20px rgba(255, 167, 38, 0.5); }
      }
    </style>
    <div class="chatbot-header" style="
      ${headerStyle.backgroundColor ? `background-color: ${headerStyle.backgroundColor};` : ''}
      ${headerStyle.textColor ? `color: ${headerStyle.textColor};` : ''}
    ">
      <div class="chatbot-header-top">
        ${headerStyle.icon ? 
          `<img src="${headerStyle.icon}" class="chatbot-header-icon" 
            style="width: ${headerStyle.iconSize || '30px'}; height: ${headerStyle.iconSize || '30px'};">` : ''}
        <span class="chatbot-header-title">${this.config.botName}</span>
        <button class="chatbot-header-close" style="
          ${headerStyle.textColor ? `color: ${headerStyle.textColor};` : ''}
        ">&times;</button>
      </div>
    </div>
    
    <div class="chatbot-content">
      <!-- Home Tab -->
      <div class="chatbot-tab-content active" data-content="home">
        <div class="chatbot-home-content">
          <div class="chatbot-home-welcome">
            <h2>Welcome!</h2>
            <p>How can we help you today?</p>
          </div>
          
          <div class="chatbot-actions-grid">
            <div class="chatbot-action-card" data-action="voice-call">
              <span class="chatbot-action-icon">📞</span>
              <div class="chatbot-action-title">Call Us</div>
              <div class="chatbot-action-desc">Start a voice conversation with us</div>
              <div class="chatbot-language-switch">
                <span>🌐</span>
                <button class="lang-btn active" data-lang="en">EN</button>
                <button class="lang-btn" data-lang="ar">AR</button>
              </div>
            </div>
            <div class="chatbot-action-card" data-action="start-chat">
              <span class="chatbot-action-icon">💬</span>
              <div class="chatbot-action-title">Start Chat</div>
              <div class="chatbot-action-desc">Begin a conversation with our assistant</div>
            </div>
            <div class="chatbot-action-card" data-action="check-products">
              <span class="chatbot-action-icon">🏪</span>
              <div class="chatbot-action-title">Our Products</div>
              <div class="chatbot-action-desc">Explore our product offerings</div>
            </div>
            <div class="chatbot-action-card" data-action="contact-us">
              <span class="chatbot-action-icon">✉️</span>
              <div class="chatbot-action-title">Contact Us</div>
              <div class="chatbot-action-desc">Get in touch with support</div>
            </div>
            <div class="chatbot-action-card" data-action="faq">
              <span class="chatbot-action-icon">❓</span>
              <div class="chatbot-action-title">FAQ</div>
              <div class="chatbot-action-desc">Find answers to common questions</div>
            </div>
          </div>
          
          <div class="chatbot-user-actions" style="display: none;">
            <h3>Your Account</h3>
            <div class="chatbot-user-notifications"></div>
          </div>
        </div>
      </div>
      
      <!-- Chat Tab -->
      <div class="chatbot-tab-content" data-content="chat">
        <div class="chatbot-chat-content">
          <div class="chatbot-messages"></div>
          <div class="chatbot-input-area">
            <input type="text" placeholder="${this.config.inputPlaceholder}" />
            <button class="chatbot-send-button">${this.config.sendButtonText}</button>
          </div>
        </div>
        
        <!-- Terms Overlay -->
        <div class="chatbot-terms-overlay">
          <div class="chatbot-terms-content">
            <div class="chatbot-terms-title">Terms & Conditions</div>
            <div class="chatbot-terms-text">
              Before we start, and for your protection, please don't type any account or card numbers on the screen or any of your PINs. Please also note that we will be keeping a record of this conversation for service quality purposes. I am here to help you with general inquiries about the Bank, its products and services. If you need to access your bank accounts or cards,
            </div>
            <div class="chatbot-terms-text">
              Dear customer, in order to ensure the confidentiality of your data, please do not share the three numbers on the back of the credit or debit card, the OTP or the password for the smart wallet service or the Internet banking with anyone, whether by phone, text message or e-mail and in case that this data is requested by any means of communication, please contact 19666 as soon as possible.
            </div>
            <div class="chatbot-terms-buttons">
              <button class="chatbot-terms-accept">I Agree</button>
              <button class="chatbot-terms-decline">Decline</button>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Announcements Tab -->
      <div class="chatbot-tab-content" data-content="announcements">
        <div class="chatbot-announcements-content">
          <div class="chatbot-announcements-list"></div>
        </div>
      </div>
    </div>
    
    <div class="chatbot-footer" style="
      text-align: center;
      padding: 10px;
      font-size: 12px;
      font-family: 'Segoe UI', sans-serif;
      background: #fdfdfd;
    ">
      <div class="chatbot-tabs">
        <button class="chatbot-tab active" data-tab="home">Home</button>
        <button class="chatbot-tab" data-tab="chat">Chat</button>
        <button class="chatbot-tab" data-tab="announcements">News</button>
      </div>
      <span style="
          background: linear-gradient(90deg, #4a90e2, #9013fe, #ff4081);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          font-weight: bold;
          font-style: italic;
          font-size: 1.1em;
          animation: shimmer 3s infinite;
          background-size: 200% auto;
          display:inline-block;
      ">Powered by Dart ✨</span>
    </div>
  `;

  container.appendChild(windowEl);
  this.elements.window = windowEl;
  this.elements.messagesContainer = windowEl.querySelector('.chatbot-messages');
  this.elements.inputField = windowEl.querySelector('.chatbot-input-area input');
  this.elements.sendButton = windowEl.querySelector('.chatbot-input-area button');
  this.elements.closeButton = windowEl.querySelector('.chatbot-header-close');
  this.elements.headerTitle = windowEl.querySelector('.chatbot-header-title');
  this.elements.homeContent = windowEl.querySelector('[data-content="home"]');
  this.elements.chatContent = windowEl.querySelector('[data-content="chat"]');
  this.elements.announcementsContent = windowEl.querySelector('[data-content="announcements"]');
  this.elements.termsOverlay = windowEl.querySelector('.chatbot-terms-overlay');
  this.elements.userActions = windowEl.querySelector('.chatbot-user-actions');
  this.elements.userNotifications = windowEl.querySelector('.chatbot-user-notifications');

  // Add voice call button event listener
  const voiceCallButton = windowEl.querySelector('.chatbot-action-card[data-action="voice-call"]');
  if (voiceCallButton) {
    voiceCallButton.addEventListener('click', async () => {
      if (this.voiceCallState.isConnected) {
        await this.endVoiceCall();
      } else if (!this.voiceCallState.isConnecting) {
        await this.startVoiceCall();
      }
    });
  }
  const langButtons = windowEl.querySelectorAll('.lang-btn');
  langButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent triggering the call
      
      // Update active state
      langButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Store selected language
      this.voiceCallState.selectedLanguage = btn.dataset.lang;
      console.log('Language selected:', this.voiceCallState.selectedLanguage);
    });
  });
  // Event Listeners
  this.setupEventListeners();

  // Render messages and show
  this.messages.forEach(msg => this.displayMessage(msg, false));
  this.scrollToBottom();
  this.showWidget();

  // Start auto-refresh if configured
  if (this.config.autoRefresh) {
    this.startAutoRefresh(this.config.autoRefreshInterval || 300000);
  }
}

  setupEventListeners() {
    // Close button
    this.elements.closeButton.addEventListener('click', () => this.toggleChatWindow());
    
    // Send message
    this.elements.sendButton.addEventListener('click', () => this.sendMessage());
    this.elements.inputField.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendMessage();
    });

    // Tab navigation
    const tabs = this.elements.window.querySelectorAll('.chatbot-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        this.switchTab(tabName);
      });
    });

    // Home actions
    const actionCards = this.elements.window.querySelectorAll('.chatbot-action-card');
    actionCards.forEach(card => {
      card.addEventListener('click', () => {
        const action = card.dataset.action;
        this.handleHomeAction(action);
      });
    });

    // Terms acceptance
    const termsAccept = this.elements.window.querySelector('.chatbot-terms-accept');
    const termsDecline = this.elements.window.querySelector('.chatbot-terms-decline');
    
    termsAccept.addEventListener('click', () => {
      this.termsAccepted = true;
      this.elements.termsOverlay.style.display = 'none';
    });
    
    termsDecline.addEventListener('click', () => {
      this.switchTab('home');
    });
  }

  switchTab(tabName) {
    // Update active tab button
    const tabs = this.elements.window.querySelectorAll('.chatbot-tab');
    tabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update active content
    const contents = this.elements.window.querySelectorAll('.chatbot-tab-content');
    contents.forEach(content => {
      content.classList.toggle('active', content.dataset.content === tabName);
    });

    this.currentTab = tabName;

    // Handle tab-specific actions
    if (tabName === 'chat') {
      if (!this.termsAccepted) {
        this.elements.termsOverlay.style.display = 'flex';
      }
      // Always scroll to bottom when opening chat tab
      setTimeout(() => {
        this.scrollToBottom();
      }, 100);
    }


    if (tabName === 'announcements' && this.announcements.length === 0) {
      this.loadAnnouncements();
    }
  }

  handleHomeAction(action) {
    switch (action) {
      case 'start-chat':
        this.switchTab('chat');
        break;
      case 'check-products':
        this.switchTab('chat');
        if (this.termsAccepted) {
          setTimeout(() => {
            this.sendMessage('Show me your products', '/list_product_list');
          }, 500);
        }
        break;
      case 'contact-us':
        this.switchTab('chat');
        if (this.termsAccepted) {
          setTimeout(() => {
            this.sendMessage('I need to contact support', '/contact_support');
          }, 500);
        }
        break;
      case 'faq':
        this.switchTab('chat');
        if (this.termsAccepted) {
          setTimeout(() => {
            this.sendMessage('Show me frequently asked questions', '/show_faq');
          }, 500);
        }
        break;
    }
  }

  async loadUserNotifications() {
    if (!authToken) return;

    try {
      const response = await fetch(this.config.startingUrl, {
        method: 'GET',
        headers: { 
          'Content-Type': 'application/json',
          'authorization': `Bearer ${authToken}`
        },
      });

      if (response.ok) {
        const notifications = await response.json();
        this.userNotifications = notifications;
        
        this.renderUserNotifications();
      }
    } catch (error) {
      console.error('Failed to load user notifications:', error);
    }
  }

  renderUserNotifications() {
    if (!this.elements.userActions || !this.elements.userNotifications) return;

    // Clear existing notifications
    this.elements.userNotifications.innerHTML = '';
    
    // Flatten the notifications into a single array of actionable items
    const actionableItems = [];
    this.userNotifications.forEach(notification => {
      // Add the main notification text as a standalone card if it exists
      if (notification.text) {
        actionableItems.push({
          text: notification.text,
          url: null // No action for the main text
        });
      }
      // Add each button as a separate actionable item
      if (notification.buttons) {
        notification.buttons.forEach(btn => {
          actionableItems.push({
            text: btn.title,
            url: btn.url,
          });
        });
      }
    });

    if (actionableItems.length === 0) {
      this.elements.userActions.style.display = 'none';
      return;
    }

    this.elements.userActions.style.display = 'block';

    actionableItems.forEach(item => {
      const card = document.createElement('div');
      card.className = 'chatbot-notification-card';
      
      // Add the notification text
      const textDiv = document.createElement('div');
      textDiv.className = 'chatbot-notification-text';
      textDiv.textContent = item.text;
      card.appendChild(textDiv);
      
      // Add a button if a URL is available
      if (item.url) {
        const actionButton = document.createElement('button');
        actionButton.className = 'chatbot-notification-button';
        actionButton.textContent = 'View Details'; // A generic, actionable text
        actionButton.onclick = () => window.open(item.url, '_blank');
        card.appendChild(actionButton);
      }
      
      this.elements.userNotifications.appendChild(card);
    });
  }

  updateUIElements() {
    if (this.elements.headerTitle) {
      this.elements.headerTitle.textContent = this.config.botName;
    }
    
    if (this.elements.inputField) {
      this.elements.inputField.placeholder = this.config.inputPlaceholder;
    }
    
    if (this.elements.sendButton) {
      this.elements.sendButton.textContent = this.config.sendButtonText;
    }
  }

  showWidget() {
    console.log('Attempting to show widget...');

    // Force visibility for debugging
    this.elements.container.style.display = 'block';
    this.elements.container.style.opacity = '1';
    this.elements.container.style.zIndex = '99999';
    
    // Original animation code
    const animation = this.config.style?.animation || { type: 'fade-in', duration: 300 };
    console.log('Using animation:', animation);

    this.elements.container.style.display = 'block';
    
    if (animation.type === 'fade-in') {
      setTimeout(() => {
        this.elements.container.style.opacity = '1';
      }, 50);
    } else if (animation.type === 'slide-up') {
      this.elements.container.style.transform = 'translateY(20px)';
      setTimeout(() => {
        this.elements.container.style.transition = `all ${animation.duration}ms ease`;
        this.elements.container.style.opacity = '1';
        this.elements.container.style.transform = 'translateY(0)';
      }, 50);
    } else {
      this.elements.container.style.opacity = '1';
    }
  }

  // --- Auto Refresh ---
  startAutoRefresh(interval = 300000) {
    this.stopAutoRefresh();
    this.refreshInterval = setInterval(() => this.refreshConfig(), interval);
    this.log(`Started auto-refresh every ${interval/1000} seconds`);
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }



  // --- Message Handling ---
  displayMessage(message, save = true) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chatbot-message', message.sender === 'user' ? 'user' : 'bot');

    if (message.text) {
      const textContent = document.createElement('div');
      textContent.innerHTML = parseMarkdown(message.text);
      messageElement.appendChild(textContent);
    }

    if (message.buttons?.length > 0) {
      const buttonContainer = renderMessage(message, 'buttons', this.sendMessage.bind(this));
      if (buttonContainer) messageElement.appendChild(buttonContainer);
    }
    
    if (message.image) {
      const imageEl = renderMessage(message, 'image');
      if (imageEl) messageElement.appendChild(imageEl);
    }
    
    if (message.video) {
      const videoEl = renderMessage(message, 'video');
      if (videoEl) messageElement.appendChild(videoEl);
    }
    
    if (message.carousel?.length > 0) {
      const carouselEl = renderMessage(message, 'carousel', this.sendMessage.bind(this));
      if (carouselEl) messageElement.appendChild(carouselEl);
    }
    
    if (message.custom) {
      const customEl = renderCustomPayload(message.custom, this.sendMessage.bind(this));
      if (customEl) messageElement.appendChild(customEl);
    }

    this.elements.messagesContainer.appendChild(messageElement);
    
    if (save) {
      this.messages.push(message);
      setLocalStorageItem(`chatbot_conversation_${this.sessionId}`, this.messages);
    }
    
    this.scrollToBottom();
  }

  async sendSuggestions() {
    try {
      const response = await fetch(this.config.startingUrl, {
        method: 'GET',
        headers: { 
          'Content-Type': 'application/json',
          'authorization': `Bearer ${authToken}`
        },
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const botResponses = await response.json();
      if (botResponses?.length > 0) {
        console.log(authToken+" --- IGNORE ---");
        botResponses.forEach(response => this.displayMessage({ sender: 'bot', ...response }));
      } else {
        this.displayMessage({ sender: 'bot', text: "Sorry, I didn't get a response." });
      }
    } catch (error) {
      console.error('Chatbot error:', error);
      this.displayMessage({ 
        sender: 'bot', 
        text: "I'm having trouble connecting. Please try again later." 
      });
    }
  }

  async sendMessage(text = null, payload = null) {
    let messageText = text || this.elements.inputField.value.trim();
    if (!messageText && !payload) return;

    const userMessage = { sender: 'user', text: messageText };
    this.displayMessage(userMessage);
    this.elements.inputField.value = '';

    const requestBody = {
      sender: this.sessionId,
      message: messageText,
      ...(payload && { customData: { payload } })
    };

    try {
      const response = await fetch(this.config.botUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const botResponses = await response.json();
      if (botResponses?.length > 0) {
        console.log(authToken+" --- IGNORE ---");
        botResponses.forEach(response => this.displayMessage({ sender: 'bot', ...response }));
      } else {
        this.displayMessage({ sender: 'bot', text: "Sorry, I didn't get a response." });
      }
    } catch (error) {
      console.error('Chatbot error:', error);
      this.displayMessage({ 
        sender: 'bot', 
        text: "I'm having trouble connecting. Please try again later." 
      });
    }
  }

  // --- UI Controls ---
  toggleChatWindow() {
    this.isOpen = !this.isOpen;
    this.elements.window.classList.toggle('open', this.isOpen);
    this.elements.bubble.classList.toggle('hidden', this.isOpen);

    if (this.isOpen) {
      if (is_first_log_in && authToken) {
        is_first_log_in = false;
        this.sendSuggestions();
      }
      this.stopMessageCycle();

      this.elements.inputField.focus();
      this.scrollToBottom();
    }else {
        setTimeout(() => {
          if (!this.isOpen) { // Double-check chat is still closed
            this.startMessageCycle();
          }
        }, 2000);
    }
  }

  scrollToBottom() {
    if (this.elements.messagesContainer) {
      this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
    }
  }
}

// Initialize

window.ChatbotSDK = new ChatbotWidget();
window.ChatbotSDK.init();



(function() {
  const chatbotContainer = document.getElementById('chatbotContainer');

  // Public function to set the authentication token inside the SDK
  window.setChatbotAuthToken = function(token) {
    authToken = token;
    console.log("Chatbot SDK received a token. Saved locally.");
    console.log("Simulated Chatbot Auth Token:", authToken);
    
    // Reload user notifications if widget is open
    if (window.ChatbotSDK && window.ChatbotSDK.isOpen && authToken && is_first_log_in) {
        is_first_log_in = false;
      window.ChatbotSDK.sendSuggestions();
    }
  };
  
  // Initial chatbot state when the page loads
  console.log("Chatbot SDK loaded. Chatbot is running but currently unauthenticated.");
})();