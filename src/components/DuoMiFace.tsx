import React, { useEffect, useState } from 'react';
import type { Mood } from '../types';

interface DuoMiFaceProps {
  mood: Mood | 'neutral';
  className?: string;
}

const moodEmoji: Record<Mood | 'neutral', string> = {
  happy: '\u{1F60A}',
  angry: '\u{1F620}',
  sad: '\u{1F614}',
  naughty: '\u{1F61C}',
  surprised: '\u{1F62E}',
  sleepy: '\u{1F634}',
  shy: '\u{1F633}',
  proud: '\u{1F60C}',
  scared: '\u{1F630}',
  neutral: '\u{1F610}',
};

export const DuoMiFace: React.FC<DuoMiFaceProps> = ({ mood, className = "" }) => {
  const [imgError, setImgError] = useState(false);
  const imgSrc = `/mood-${mood === 'neutral' ? 'happy' : mood}.png`;

  useEffect(() => {
    setImgError(false);
  }, [imgSrc]);

  if (imgError) {
    return (
      <span className={`inline-flex items-center justify-center ${className}`} role="img" aria-label={`Mood: ${mood}`}>
        {moodEmoji[mood]}
      </span>
    );
  }

  return (
    <img
      src={imgSrc}
      alt={`Mood: ${mood}`}
      className={`object-contain ${className}`}
      onError={() => setImgError(true)}
    />
  );
};
