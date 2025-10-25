import React, { useRef, useEffect } from 'react';
import { Field } from '../types';

interface TextInputProps {
  field: Field;
  onChange: (fieldId: string, value: string) => void;
  onUpdate: (fieldId: string, newProps: Partial<Pick<Field, 'top' | 'height'>>) => void;
  isEditMode: boolean;
  index: number;
  onAutoResize: (fieldId: string, pixelHeight: number) => void;
}

const TextInput: React.FC<TextInputProps> = ({ field, onChange, onUpdate, isEditMode, index, onAutoResize }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragInfo = useRef<{
    type: 'top' | 'bottom';
    initialY: number;
    initialTop: number;
    initialHeight: number;
  } | null>(null);

  // Synchronize state to DOM without losing cursor position
  useEffect(() => {
    if (contentRef.current && field.value !== contentRef.current.innerHTML) {
      contentRef.current.innerHTML = field.value;
    }
  }, [field.value]);
  
  // Auto-resize logic
  useEffect(() => {
    if (isEditMode && contentRef.current && wrapperRef.current) {
        // We need a small buffer. Sometimes scrollHeight is slightly larger than needed.
        // Also ensures there's a bit of padding at the bottom.
        const requiredHeight = contentRef.current.scrollHeight + 5;
        const currentHeight = wrapperRef.current.offsetHeight;

        // Only trigger resize if the difference is significant to avoid infinite loops or jitter.
        if (Math.abs(requiredHeight - currentHeight) > 2) {
             onAutoResize(field.id, requiredHeight);
        }
    }
  }, [field.value, isEditMode, onAutoResize, field.id, field.height]); // Rerun if height changes from parent


  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    onChange(field.id, e.currentTarget.innerHTML);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isEditMode) {
      e.preventDefault();
      return;
    }
    // Overflow prevention removed to allow dynamic growth
  };

  const handleMouseDown = (type: 'top' | 'bottom') => (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isEditMode || !wrapperRef.current) return;
    e.preventDefault();

    dragInfo.current = {
      type,
      initialY: e.clientY,
      initialTop: wrapperRef.current.offsetTop,
      initialHeight: wrapperRef.current.offsetHeight,
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!dragInfo.current || !wrapperRef.current) return;

    const deltaY = e.clientY - dragInfo.current.initialY;
    let newTop = dragInfo.current.initialTop;
    let newHeight = dragInfo.current.initialHeight;

    if (dragInfo.current.type === 'top') {
      newTop += deltaY;
      newHeight -= deltaY;
    } else { // bottom
      newHeight += deltaY;
    }

    // Enforce min-height
    if (newHeight < 40) {
      if (dragInfo.current.type === 'top') {
        newTop = newTop + (newHeight - 40);
      }
      newHeight = 40;
    }

    wrapperRef.current.style.top = `${newTop}px`;
    wrapperRef.current.style.height = `${newHeight}px`;
  };

  const handleMouseUp = () => {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);

    if (!dragInfo.current || !wrapperRef.current) return;

    const wrapper = wrapperRef.current;
    const parent = wrapper.parentElement?.parentElement;
    if (!parent) return;

    const newPixelTop = wrapper.offsetTop;
    const newPixelHeight = wrapper.offsetHeight;
    const parentPixelHeight = parent.clientHeight;

    const newPercentageHeight = (newPixelHeight / parentPixelHeight) * 100;

    const newProps: Partial<Pick<Field, 'top' | 'height'>> = {
      height: `${newPercentageHeight.toFixed(2)}%`,
    };

    if (dragInfo.current.type === 'top') {
      const newPercentageTop = (newPixelTop / parentPixelHeight) * 100;
      newProps.top = `${newPercentageTop.toFixed(2)}%`;
    }

    onUpdate(field.id, newProps);

    dragInfo.current = null;
  };

  const editModeClasses = "bg-gray-100 border border-gray-300 shadow-sm rounded-md focus-within:bg-gray-200 focus-within:ring-2 focus-within:ring-blue-500";
  const navModeClasses = "bg-transparent border-none shadow-none cursor-default";
  const handleClasses = "absolute left-0 w-full h-3 cursor-ns-resize z-10 flex items-center justify-center";
  const handleIconClasses = "w-8 h-1 bg-gray-400 rounded-full group-hover:bg-blue-500 transition-colors opacity-50 group-hover:opacity-100";

  return (
    <div
      ref={wrapperRef}
      className={`absolute group print:bg-transparent print:border-none print:p-0 print:shadow-none overflow-hidden ${isEditMode ? editModeClasses : navModeClasses}`}
      style={{
        top: field.top,
        left: field.left,
        width: field.width,
        height: field.height,
        transition: dragInfo.current ? 'none' : 'all 0.2s ease-in-out',
      }}
    >
      {isEditMode && (
        <>
          <div className={`${handleClasses} -top-1.5`} onMouseDown={handleMouseDown('top')}>
            <div className={handleIconClasses} />
          </div>
          <div className={`${handleClasses} -bottom-1.5`} onMouseDown={handleMouseDown('bottom')}>
            <div className={handleIconClasses} />
          </div>
        </>
      )}
      <div
        ref={contentRef}
        contentEditable={isEditMode}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        data-placeholder={field.placeholder}
        className="w-full p-2 text-base leading-relaxed outline-none"
        style={{
          fontFamily: field.fontFamily,
          fontSize: `${field.fontSize}px`,
          fontWeight: field.fontWeight,
          color: field.color,
          minHeight: '40px',
        }}
      />
      <div className="absolute bottom-1 right-1 bg-blue-500 text-white text-xs rounded-sm px-1.5 py-0.5 pointer-events-none z-10">
        {index}
      </div>
    </div>
  );
};

export default TextInput;