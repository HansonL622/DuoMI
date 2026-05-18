import React, { useState } from 'react';
import type { DiaryEntry } from '../types';
import { DuoMiFace } from './DuoMiFace';
import { ChevronLeft, ChevronRight, PenLine, Pencil, Trash2 } from 'lucide-react';

interface CalendarViewProps {
  entries: DiaryEntry[];
  onAddMemory?: (date: Date) => void;
  onEditEntry?: (entry: DiaryEntry) => void;
  onDeleteEntry?: (entry: DiaryEntry) => void;
}

export const CalendarView: React.FC<CalendarViewProps> = ({ entries, onAddMemory, onEditEntry, onDeleteEntry }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const isSameDay = (d1: Date, d2: Date) => {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
  };

  // Create a map of entries by date string (YYYY-MM-DD)
  const entriesByDate = entries.reduce((acc, entry) => {
    const date = new Date(entry.timestamp || Date.now());
    const dateStr = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (!acc[dateStr]) {
      acc[dateStr] = [];
    }
    acc[dateStr].push(entry);
    return acc;
  }, {} as Record<string, DiaryEntry[]>);

  const days = [];
  for (let i = 0; i < firstDay; i++) {
    days.push(<div key={`empty-${i}`} className="h-10"></div>);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const dateStr = `${year}-${month}-${d}`;
    const dayEntries = entriesByDate[dateStr] || [];
    const isSelected = selectedDate && isSameDay(date, selectedDate);
    const isToday = isSameDay(date, new Date());
    const hasEntries = dayEntries.length > 0;

    days.push(
      <button
        key={d}
        onClick={() => setSelectedDate(date)}
        className={`h-12 flex flex-col items-center justify-center rounded-xl relative transition-all ${
          isSelected ? 'bg-[#F4A261] text-white shadow-md' : 
          hasEntries ? 'bg-[#FFF0E5] text-[#F4A261] font-bold' :
          isToday ? 'border border-[#F4A261] text-[#F4A261] font-bold' : 'hover:bg-[#F4F5F7] text-[#3D3D3D]'
        }`}
      >
        <span className="text-sm z-10">{d}</span>
      </button>
    );
  }

  const selectedDateStr = selectedDate ? `${selectedDate.getFullYear()}-${selectedDate.getMonth()}-${selectedDate.getDate()}` : '';
  const selectedEntries = selectedDateStr ? (entriesByDate[selectedDateStr] || []) : [];

  return (
    <div className="flex flex-col h-full">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-[#3D3D3D] mb-1">心情日历</h2>
        <p className="text-sm text-[#8C8C8C]">回顾与 DuoMi 一起走过的日子</p>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-[#F0EBE1] p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} className="p-2 hover:bg-[#F4F5F7] rounded-full transition-colors text-[#8C8C8C]">
            <ChevronLeft size={20} />
          </button>
          <h3 className="font-bold text-[#3D3D3D]">
            {currentDate.toLocaleString('default', { year: 'numeric', month: 'long' })}
          </h3>
          <button onClick={nextMonth} className="p-2 hover:bg-[#F4F5F7] rounded-full transition-colors text-[#8C8C8C]">
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-2 text-center">
          {['日', '一', '二', '三', '四', '五', '六'].map(day => (
            <div key={day} className="text-[10px] font-bold text-[#A0A0A0] py-2">{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        {selectedDate && (
          <h3 className="text-xs font-bold uppercase tracking-widest text-[#A0A0A0] mb-4 flex items-center gap-2">
            {selectedDate.toLocaleDateString([], { month: 'short', day: 'numeric' })} 的记录 <span className="h-px flex-1 bg-[#F0EBE1]"></span>
          </h3>
        )}

        {selectedEntries.length === 0 ? (
          <div className="text-center py-10 text-[#A0A0A0] text-sm flex flex-col items-center gap-4">
            <p>这一天没有记录哦~</p>
            <button 
              onClick={() => selectedDate && onAddMemory?.(selectedDate)}
              className="flex items-center gap-2 text-[#F4A261] font-bold bg-[#FFF0E5] px-5 py-2.5 rounded-full text-xs hover:bg-[#FFE4D6] transition-colors shadow-sm"
            >
              <PenLine size={14} />
              补充这一天的记忆
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {selectedEntries.map(entry => (
              <div key={entry.id} className="bg-white p-4 rounded-2xl shadow-sm border border-[#F0EBE1]">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-medium text-[#A0A0A0]">{entry.date}</div>
                  <div className="flex items-center gap-1.5">
                    {entry.mood && (
                      <div className="flex items-center gap-1 bg-[#FFF0E5] px-2 py-1 rounded-lg">
                        <DuoMiFace mood={entry.mood} className="w-4 h-4" />
                        <span className="text-[10px] font-bold text-[#F4A261]">
                          {{
                            happy: '开心', angry: '生气', sad: '难过',
                            naughty: '调皮', surprised: '惊讶', sleepy: '困倦',
                            shy: '害羞', proud: '得意', scared: '害怕'
                          }[entry.mood]}
                        </span>
                      </div>
                    )}
                    <button onClick={() => onEditEntry?.(entry)} className="p-1.5 rounded-full text-[#A0A0A0] hover:text-[#F4A261] hover:bg-[#FFF0E5]">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => onDeleteEntry?.(entry)} className="p-1.5 rounded-full text-[#A0A0A0] hover:text-[#D96B52] hover:bg-[#FFF0ED]">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <p className="text-[#5C5C5C] text-sm whitespace-pre-wrap leading-relaxed">{entry.content}</p>
              </div>
            ))}
            <button 
              onClick={() => selectedDate && onAddMemory?.(selectedDate)}
              className="w-full mt-2 py-3 border-2 border-dashed border-[#F0EBE1] rounded-2xl text-[#A0A0A0] text-sm font-bold hover:bg-[#FDFBF7] hover:text-[#F4A261] hover:border-[#F4A261]/30 transition-all flex items-center justify-center gap-2"
            >
              <PenLine size={16} />
              再补充一条记忆
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
