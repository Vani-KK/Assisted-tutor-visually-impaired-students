import React, { useState, useRef, useEffect } from 'react';

// 1. ACCEPT NEW PROP: onStopRecording
function AudioRecorder({ onTranscription, onError, disabled, onStopRecording }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [hasPermission, setHasPermission] = useState(null);
  const [switchState, setSwitchState] = useState('unknown'); 
  const [isAutoMode, setIsAutoMode] = useState(true);
  const [debugMode, setDebugMode] = useState(false);
  const [pcm2902DeviceId, setPcm2902DeviceId] = useState(null);
  const [isPcm2902Connected, setIsPcm2902Connected] = useState(false);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingIntervalRef = useRef(null);
  const streamRef = useRef(null);
  const deviceCheckIntervalRef = useRef(null);
  const isConnectingRef = useRef(false);
  const lastProcessedDeviceIdRef = useRef(null);

  useEffect(() => {
    // Find and monitor PCM2902 device
    findPcm2902Device();
    
    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
      if (deviceCheckIntervalRef.current) {
        clearInterval(deviceCheckIntervalRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Re-check device when pcm2902DeviceId changes
  useEffect(() => {
    if (pcm2902DeviceId && isPcm2902Connected) {
      connectToDevice();
    }
  }, [pcm2902DeviceId]);

  const findPcm2902Device = async () => {
    // ... (rest of findPcm2902Device function remains the same)
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      
      // Look for PCM2902 device by various identifiers
      const pcm2902Device = audioInputs.find(device => {
        const label = device.label.toLowerCase();
        return label.includes('pcm2902') || 
               label.includes('texas instruments') ||
               label.includes('audio codec') ||
               label.includes('08bb:2902') ||
               label.includes('08bb') || 
               label.includes('2902') || 
               label.includes('usb pnp sound device') || 
               device.deviceId.includes('pcm2902');
      });
      
      if (pcm2902Device) {
        setPcm2902DeviceId(pcm2902Device.deviceId);
        setIsPcm2902Connected(true);
        setSwitchState('on');
        
        startDeviceMonitoring();
        
        await connectToDevice();
      } else {
        setIsPcm2902Connected(false);
        setSwitchState('off');
        startDeviceMonitoring(); 
      }
    } catch (error) {
      console.error('Error finding PCM2902 device:', error);
      setIsPcm2902Connected(false);
      setSwitchState('unknown');
    }
  };

  const startDeviceMonitoring = () => {
    // ... (rest of startDeviceMonitoring function remains the same)
    if (deviceCheckIntervalRef.current) {
      clearInterval(deviceCheckIntervalRef.current);
    }
    
    deviceCheckIntervalRef.current = setInterval(async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        
        // Look for PCM2902 device
        const pcm2902Device = audioInputs.find(device => {
          const label = device.label.toLowerCase();
          return label.includes('pcm2902') || 
                 label.includes('texas instruments') ||
                 label.includes('audio codec') ||
                 label.includes('08bb:2902') ||
                 label.includes('08bb') || 
                 label.includes('2902') || 
                 label.includes('usb pnp sound device') || 
                 device.deviceId.includes('pcm2902');
        });
        
        const deviceFound = !!pcm2902Device;
        
        // Additional check: if we have a stored device ID, check if it still exists
        const currentDeviceStillExists = pcm2902DeviceId ? 
          audioInputs.some(device => device.deviceId === pcm2902DeviceId) : false;
        
        if (debugMode) {
          console.log('Device monitoring:', {
            deviceFound,
            isPcm2902Connected,
            currentDeviceStillExists,
            isRecording
          });
        }
        
        if ((!deviceFound || !currentDeviceStillExists) && isPcm2902Connected) {
          stopRecording();
          
          setIsPcm2902Connected(false);
          setSwitchState('off');
          setPcm2902DeviceId(null);
          setHasPermission(null);
          lastProcessedDeviceIdRef.current = null; 
          
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
          }
          
        } else if (deviceFound && !isPcm2902Connected && !isConnectingRef.current && 
                   pcm2902Device.deviceId !== lastProcessedDeviceIdRef.current) {
          isConnectingRef.current = true;
          lastProcessedDeviceIdRef.current = pcm2902Device.deviceId;
          
          setIsPcm2902Connected(true);
          setSwitchState('on');
          setPcm2902DeviceId(pcm2902Device.deviceId);
          
          try {
            await connectToDevice();
          } catch (error) {
            console.error('Error connecting to device:', error);
          } finally {
            isConnectingRef.current = false;
          }
        }
      } catch (error) {
        console.error('Error monitoring device:', error);
        isConnectingRef.current = false;
      }
    }, 500); 
  };

  const connectToDevice = async () => {
    // ... (rest of connectToDevice function remains the same)
    if (!pcm2902DeviceId || !isPcm2902Connected) {
      setHasPermission(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
          deviceId: { exact: pcm2902DeviceId } 
        } 
      });
      setHasPermission(true);
      streamRef.current = stream;
      setConnectionAttempts(0);
      
      stream.getTracks().forEach(track => {
        track.onended = () => {
          if (isPcm2902Connected) {
            stopRecording();
            
            setIsPcm2902Connected(false);
            setSwitchState('off');
            setPcm2902DeviceId(null);
            setHasPermission(null);
            lastProcessedDeviceIdRef.current = null;
          }
        };
      });
      
      if (isAutoMode && !disabled && !isRecording && !mediaRecorderRef.current) {
        await startRecording();
      }
      
    } catch (error) {
      setHasPermission(false);
      setConnectionAttempts(prev => prev + 1);
      console.error('Failed to access PCM2902 microphone:', error);
      if (connectionAttempts < 3) {
        setTimeout(connectToDevice, 1000);
      } else {
        onError('Failed to access PCM2902 microphone. Please check permissions and try again.');
      }
    }
  };


  const startRecording = async () => {
    // ... (rest of startRecording function remains the same)
    if (!isPcm2902Connected || !pcm2902DeviceId) {
      onError('PCM2902 microphone not connected');
      return;
    }

    if (isRecording || mediaRecorderRef.current) {
      return;
    }

    try {
      let stream = streamRef.current;
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 48000,
            deviceId: { exact: pcm2902DeviceId } 
          } 
        });
        streamRef.current = stream;
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        processAudio(audioBlob);
        setIsRecording(false);
      };

      mediaRecorder.start(1000); 
      setIsRecording(true);
      setRecordingTime(0);

      // Start recording timer
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (error) {
      console.error('Error starting recording:', error);
      onError('Failed to start recording. Please check microphone permissions.');
    }
  };

  const stopRecording = () => {
    // 2. CAPTURE THE TIME BEFORE CLEARING THE INTERVAL
    const finalRecordingTime = recordingTime;
    
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      } catch (error) {
        console.error('Error stopping MediaRecorder:', error);
      }
      mediaRecorderRef.current = null;
    }
    
    setIsRecording(false);
    
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    // 3. CALL THE PROP FUNCTION WITH THE TIME
    if (onStopRecording && finalRecordingTime > 0) {
      onStopRecording(finalRecordingTime);
    }
  };

  // ... (rest of the component remains the same)
  const processAudio = async (audioBlob) => {
    // ... (processAudio function remains the same)
    setIsProcessing(true);
    
    try {
      // Convert audio blob to base64
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Audio = reader.result.split(',')[1];
        
        // Send to STT API
        const response = await fetch('http://localhost:3001/api/speech-to-text', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            audioData: base64Audio,
            mimeType: 'audio/webm'
          }),
        });

        const data = await response.json();

        if (response.ok && data.transcription) {
          onTranscription(data.transcription, data.confidence);
        } else {
          onError(data.message || 'Failed to transcribe audio');
        }
      };
      
      reader.readAsDataURL(audioBlob);
    } catch (error) {
      console.error('Error processing audio:', error);
      onError('Failed to process audio');
    } finally {
      setIsProcessing(false);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isPcm2902Connected && switchState === 'unknown') {
    return (
      <div className="audio-recorder error">
        <p>Searching for PCM2902 microphone... Please ensure your microphone is connected and the switch is ON.</p>
        <button onClick={findPcm2902Device} className="retry-btn">
          Refresh Search
        </button>
      </div>
    );
  }

  if (hasPermission === false && isPcm2902Connected) {
    return (
      <div className="audio-recorder error">
        <p>Microphone access denied. Please enable microphone permissions to use voice input.</p>
        <button onClick={connectToDevice} className="retry-btn">
          Retry Permission
        </button>
        {/* The rest of your return logic */}
      </div>
    );
  }

  if (hasPermission === null && isPcm2902Connected) {
    return (
      <div className="audio-recorder loading">
        <p>Connecting to PCM2902 microphone...</p>
      </div>
    );
  }

  return (
    <div className="mic-indicator-text">
      {switchState === 'on' ? 'PCM2902 Switch ON' : 
       switchState === 'off' ? 'PCM2902 Switch OFF' : 
       'Detecting PCM2902 switch...'}
    </div>
  );
}

export default AudioRecorder;