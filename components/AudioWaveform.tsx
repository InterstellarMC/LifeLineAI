import React, { useEffect, useRef } from 'react';

interface AudioWaveformProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
}

const AudioWaveform: React.FC<AudioWaveformProps> = ({ analyser, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser || !isActive) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;

        // Gradient based on height/intensity
        const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
        gradient.addColorStop(0, '#18181b'); // Zinc 900
        gradient.addColorStop(1, '#3b82f6'); // Blue 500

        ctx.fillStyle = gradient;
        
        // Rounded bars
        ctx.beginPath();
        ctx.roundRect(x, canvas.height - barHeight, barWidth, barHeight, 2);
        ctx.fill();

        x += barWidth + 1;
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [analyser, isActive]);

  if (!isActive) return null;

  return (
    <div className="absolute bottom-32 left-1/2 -translate-x-1/2 z-20 w-64 h-16 bg-black/40 backdrop-blur-md rounded-full px-6 flex items-center justify-center border border-white/10 pointer-events-none">
      <canvas ref={canvasRef} width={200} height={40} />
    </div>
  );
};

export default AudioWaveform;