import React, { useEffect, useRef } from 'react';

function AudioWaveform({ audioLevel, isRecording }) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const dataArrayRef = useRef(new Array(64).fill(0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    const drawWaveform = () => {
      // Clear canvas
      ctx.fillStyle = '#f8f9fa';
      ctx.fillRect(0, 0, width, height);

      if (!isRecording) {
        animationRef.current = requestAnimationFrame(drawWaveform);
        return;
      }

      // Update data array with new audio level
      dataArrayRef.current.shift();
      dataArrayRef.current.push(audioLevel);

      // Draw waveform
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.beginPath();

      const barWidth = width / dataArrayRef.current.length;
      
      for (let i = 0; i < dataArrayRef.current.length; i++) {
        const barHeight = (dataArrayRef.current[i] / 255) * height * 0.8;
        const x = i * barWidth;
        const y = height / 2 - barHeight / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();

      // Draw center line
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      // Draw bars for better visualization
      for (let i = 0; i < dataArrayRef.current.length; i++) {
        const barHeight = (dataArrayRef.current[i] / 255) * height * 0.6;
        const x = i * barWidth;
        const y = height / 2 - barHeight / 2;

        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        gradient.addColorStop(0, '#22c55e');
        gradient.addColorStop(1, '#16a34a');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, barWidth - 1, barHeight);
      }

      animationRef.current = requestAnimationFrame(drawWaveform);
    };

    drawWaveform();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [audioLevel, isRecording]);

  return (
    <div className="audio-waveform-container">
      <div className="waveform-label">
        {isRecording ? '🎤 Recording...' : 'Microphone'}
      </div>
      <canvas
        ref={canvasRef}
        width={300}
        height={60}
        className="audio-waveform"
      />
      <div className="waveform-level">
        Level: {Math.round((audioLevel / 255) * 100)}%
      </div>
    </div>
  );
}

export default AudioWaveform;


