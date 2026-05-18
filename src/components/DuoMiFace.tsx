import React from 'react';
import type { Mood } from '../types';

interface DuoMiFaceProps {
  mood: Mood | 'neutral';
  className?: string;
}

export const DuoMiFace: React.FC<DuoMiFaceProps> = ({ mood, className = "" }) => {
  // If we don't have a specific image for neutral, we can fallback to happy or just show the image
  const imgSrc = `/mood-${mood === 'neutral' ? 'happy' : mood}.png`;

  return (
    <img 
      src={imgSrc} 
      alt={`Mood: ${mood}`} 
      className={`object-contain ${className}`}
      onError={(e) => {
        // Fallback if image not found
        e.currentTarget.style.display = 'none';
      }}
    />
  );
};
