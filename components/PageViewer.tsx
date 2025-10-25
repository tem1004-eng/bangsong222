import React, { useRef, useEffect } from 'react';
import { Page, Path, Tool, Point, Field } from '../types';
import TextInput from './TextInput';
import PageToolbar from './PageToolbar';

interface PageViewerProps {
  page: Page;
  onTextChange: (pageId: number, fieldId: string, value: string) => void;
  onFieldUpdate: (pageId: number, fieldId: string, newProps: Partial<Field>) => void;
  onLayoutUpdate: (pageId: number, fieldId: string, newHeightPercentage: number) => void;
  paths: Path[];
  onPathsChange: (newPaths: Path[]) => void;
  tool: Tool;
  setTool: (tool: Tool) => void;
  penColor: string;
  setPenColor: (color: string) => void;
  penWidth: number;
  setPenWidth: (width: number) => void;
  isCurrentPage: boolean;
  isEditMode: boolean;
  onPrev: () => void;
  onNext: () => void;
}

const PageViewer: React.FC<PageViewerProps> = ({ page, onTextChange, onFieldUpdate, onLayoutUpdate, paths, onPathsChange, tool, setTool, penColor, setPenColor, penWidth, setPenWidth, isCurrentPage, isEditMode, onPrev, onNext }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawing = useRef(false);
  const currentPath = useRef<Path | null>(null);
  const touchStartX = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (tool === 'pen' || tool === 'eraser') {
      handleDrawStart(e);
    } else if (tool === 'select' && !isEditMode) {
      // Check for two fingers to start navigation swipe
      if (e.touches.length === 2) {
        // Use the midpoint of the two touches as the starting X-coordinate
        const midpointX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        touchStartX.current = midpointX;
      } else {
        // Not a two-finger touch, so don't start a swipe.
        touchStartX.current = null;
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (tool === 'pen' || tool === 'eraser') {
      handleDrawEnd();
    } else if (tool === 'select' && !isEditMode && touchStartX.current !== null) {
      // A two-finger swipe was initiated.
      // Use the position of the first lifted finger as the end point.
      const touchEndX = e.changedTouches[0].clientX;
      const deltaX = touchEndX - touchStartX.current;
      const SWIPE_THRESHOLD = 50; // Minimum distance for a swipe

      if (deltaX > SWIPE_THRESHOLD) {
        onPrev(); // Swipe right
      } else if (deltaX < -SWIPE_THRESHOLD) {
        onNext(); // Swipe left
      }
    }
    // Always reset on touch end
    touchStartX.current = null;
  };


  const drawPath = (ctx: CanvasRenderingContext2D, path: Path) => {
    ctx.beginPath();
    ctx.strokeStyle = path.color;
    ctx.lineWidth = path.lineWidth;
    ctx.globalCompositeOperation = path.mode === 'eraser' ? 'destination-out' : 'source-over';
    
    if (path.points.length > 0) {
      ctx.moveTo(path.points[0].x, path.points[0].y);
      for (let i = 1; i < path.points.length; i++) {
        ctx.lineTo(path.points[i].x, path.points[i].y);
      }
    }
    ctx.stroke();
  };
  
  const redrawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paths.forEach(path => drawPath(ctx, path));
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    redrawCanvas();
  }, [paths, page.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    
    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if(ctx) {
           ctx.lineCap = 'round';
           ctx.lineJoin = 'round';
           redrawCanvas();
        }
      }
    });
    
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [paths]);


  const getPoint = (e: React.MouseEvent | React.TouchEvent): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const touch = 'touches' in e ? e.touches[0] : e;
    return {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top
    };
  };

  const handleDrawStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    isDrawing.current = true;
    const point = getPoint(e);
    if (!point) return;

    currentPath.current = {
      points: [point],
      color: penColor,
      lineWidth: tool === 'eraser' ? 20 : penWidth,
      mode: tool === 'eraser' ? 'eraser' : 'pen',
    };
  };
  
  const handleDrawMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current || !currentPath.current) return;
    e.preventDefault();

    const point = getPoint(e);
    if (!point) return;

    currentPath.current.points.push(point);

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx) {
      // FIX: Redraw everything on each move to prevent disappearing lines on re-render.
      // 1. Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // 2. Redraw all committed paths
      paths.forEach(path => drawPath(ctx, path));
      // 3. Draw the current, uncommitted path
      drawPath(ctx, currentPath.current);
    }
  };

  const handleDrawEnd = () => {
    if (isDrawing.current && currentPath.current && currentPath.current.points.length > 1) {
        onPathsChange([...paths, currentPath.current]);
    }
    isDrawing.current = false;
    currentPath.current = null;
    // Redraw after finishing to ensure consistency, especially for single dots.
    redrawCanvas();
  };

  const handleAutoResize = (fieldId: string, newPixelHeight: number) => {
    if (!containerRef.current || !isEditMode) return;
    const containerHeight = containerRef.current.offsetHeight;
    if (containerHeight > 0) {
        const newHeightPercentage = (newPixelHeight / containerHeight) * 100;
        onLayoutUpdate(page.id, fieldId, newHeightPercentage);
    }
  };


  return (
    <div className="w-full max-w-4xl mx-auto">
        <PageToolbar 
            tool={tool}
            setTool={setTool}
            penColor={penColor}
            setPenColor={setPenColor}
            penWidth={penWidth}
            setPenWidth={setPenWidth}
            isEditMode={isEditMode}
        />
        <div 
          ref={containerRef} 
          className={`relative w-full shadow-2xl rounded-lg overflow-hidden print-page ${isCurrentPage ? 'current-page' : ''}`} style={{ aspectRatio: '1 / 1.414' }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
        <img src={page.imageUrl} alt={`Script Page ${page.id}`} className="w-full h-full object-cover" />
        
        {/* Text inputs are rendered below the canvas layer */}
        <div className="absolute inset-0">
            {page.fields.map((field, index) => (
            <TextInput
                key={field.id}
                field={field}
                onChange={(fieldId, value) => onTextChange(page.id, fieldId, value)}
                onUpdate={(fieldId, newProps) => onFieldUpdate(page.id, fieldId, newProps)}
                isEditMode={isEditMode}
                index={index + 1}
                onAutoResize={handleAutoResize}
            />
            ))}
        </div>

        {/* Canvas is the top layer, its pointer-events are toggled based on the tool */}
        <canvas
            ref={canvasRef}
            className={`absolute inset-0 w-full h-full touch-none ${tool === 'pen' || tool === 'eraser' ? 'pointer-events-auto' : 'pointer-events-none'}`}
            onMouseDown={handleDrawStart}
            onMouseMove={handleDrawMove}
            onMouseUp={handleDrawEnd}
            onMouseLeave={handleDrawEnd}
            onTouchMove={handleDrawMove}
        />
        </div>
    </div>
  );
};

export default PageViewer;