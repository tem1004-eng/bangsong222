import React, { useState, useCallback, useRef, useEffect } from 'react';
import PageViewer from './components/PageViewer';
import Pagination from './components/Pagination';
import Toolbar from './components/Toolbar';
import { INITIAL_PAGES } from './constants';
import { Page, Path, Tool, SavedScriptData, ScriptManifestItem, Field } from './types';
import ScriptListModal from './components/ScriptListModal';

declare const html2canvas: (element: HTMLElement, options?: any) => Promise<HTMLCanvasElement>;
declare namespace jspdf {
  class jsPDF {
    constructor(options?: any);
    addImage(imageData: string, format: string, x: number, y: number, width: number, height: number): this;
    addPage(): this;
    save(filename: string): void;
  }
}


const SCRIPT_MANIFEST_KEY = 'radioScript_manifest';
const getScriptKey = (date: string) => `radioScript_data_${date}`;
const AUTOSAVE_KEY = 'radioScript_autosave';

const normalizePageStyles = (pagesToUpdate: Page[]): Page[] => {
  return pagesToUpdate.map(page => ({
      ...page,
      fields: page.fields.map(field => ({
          ...field,
          fontFamily: "Arial",
          fontWeight: 'normal' as 'normal',
      }))
  }));
};

function App() {
  const [pages, setPages] = useState<Page[]>(INITIAL_PAGES);
  const [drawings, setDrawings] = useState<Record<number, Path[]>>({});
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [tool, setTool] = useState<Tool>('select');
  const [penColor, setPenColor] = useState('#ff0000');
  const [penWidth, setPenWidth] = useState(5);
  const [printMode, setPrintMode] = useState<'current' | 'all' | null>(null);
  
  const [broadcastDate, setBroadcastDate] = useState(new Date().toISOString().split('T')[0]);
  const [broadcastTopic, setBroadcastTopic] = useState('');
  const [isListModalOpen, setIsListModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const autoSaveTimeoutRef = useRef<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleEditMode = () => setIsEditMode(prev => !prev);

  // Check for autosaved data on initial load and restore it automatically
  useEffect(() => {
    try {
      const savedDataStr = localStorage.getItem(AUTOSAVE_KEY);
      if (savedDataStr) {
        const savedData: SavedScriptData = JSON.parse(savedDataStr);
        if (savedData.pages && Array.isArray(savedData.pages)) {
          setBroadcastDate(savedData.broadcastDate || new Date().toISOString().split('T')[0]);
          setBroadcastTopic(savedData.broadcastTopic || '');
          setPages(normalizePageStyles(savedData.pages));
          setDrawings(savedData.drawings || {});
          setCurrentPageIndex(0);
        }
      }
    } catch (e) {
      console.error("Failed to load autosaved data", e);
      localStorage.removeItem(AUTOSAVE_KEY);
    }
    setIsInitialLoad(false);
  }, []);

  // Autosave changes
  useEffect(() => {
    if (isInitialLoad) return;

    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    
    autoSaveTimeoutRef.current = window.setTimeout(() => {
      const dataToSave: SavedScriptData = { broadcastDate, broadcastTopic, pages, drawings };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(dataToSave));
    }, 1000);
  }, [broadcastDate, broadcastTopic, pages, drawings, isInitialLoad]);


  useEffect(() => {
    // This command helps ensure that execCommand generates <span> tags with style attributes
    // for styling, which is more modern than deprecated tags like <font>.
    document.execCommand('styleWithCSS', false, 'true');
  }, []);
  
  const goToNextPage = useCallback(() => {
    setCurrentPageIndex(prev => Math.min(prev + 1, pages.length - 1));
  }, [pages.length]);

  const goToPrevPage = useCallback(() => {
    setCurrentPageIndex(prev => Math.max(prev - 1, 0));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isEditMode) {
        if (e.key === 'ArrowRight') {
          goToNextPage();
        } else if (e.key === 'ArrowLeft') {
          goToPrevPage();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isEditMode, goToNextPage, goToPrevPage]);


  const handleTextChange = useCallback((pageId: number, fieldId: string, value: string) => {
    setPages(prevPages =>
      prevPages.map(page => {
        if (page.id === pageId) {
          const updatedFields = page.fields.map(field =>
            field.id === fieldId ? { ...field, value } : field
          );
          return { ...page, fields: updatedFields };
        }
        return page;
      })
    );
  }, []);

  const handleFieldUpdate = useCallback((pageId: number, fieldId: string, newProps: Partial<Field>) => {
    setPages(prevPages =>
        prevPages.map(page => {
            if (page.id === pageId) {
                const updatedFields = page.fields.map(field =>
                    field.id === fieldId ? { ...field, ...newProps } : field
                );
                return { ...page, fields: updatedFields };
            }
            return page;
        })
    );
  }, []);

  const handleLayoutUpdate = useCallback((pageId: number, fieldId: string, newHeightPercentage: number) => {
    setPages(prevPages => {
        const pageIndex = prevPages.findIndex(p => p.id === pageId);
        if (pageIndex === -1) return prevPages;

        // Create a deep enough copy to modify
        const newPages = JSON.parse(JSON.stringify(prevPages));
        const pageToUpdate = newPages[pageIndex];
        const newFields = pageToUpdate.fields;

        const fieldIndex = newFields.findIndex((f: Field) => f.id === fieldId);
        if (fieldIndex === -1) return prevPages;
        
        const targetField = newFields[fieldIndex];
        const oldHeightPercentage = parseFloat(targetField.height);

        if (isNaN(oldHeightPercentage)) {
            console.warn(`Field ${fieldId} has invalid height: ${targetField.height}`);
            return prevPages;
        }

        const deltaHeight = newHeightPercentage - oldHeightPercentage;

        if (Math.abs(deltaHeight) < 0.1) {
            return prevPages;
        }

        // 1. Update the height of the current field
        targetField.height = `${newHeightPercentage.toFixed(2)}%`;

        // 2. Update the 'top' of all subsequent fields
        for (let i = fieldIndex + 1; i < newFields.length; i++) {
            const currentField = newFields[i];
            const oldTopPercentage = parseFloat(currentField.top);
            
            if (isNaN(oldTopPercentage)) {
                console.warn(`Field ${currentField.id} has invalid top: ${currentField.top}`);
                continue;
            }

            const newTopPercentage = oldTopPercentage + deltaHeight;
            currentField.top = `${newTopPercentage.toFixed(2)}%`;
        }

        return newPages;
    });
}, []);

  const handlePathsChange = useCallback((pageId: number, newPaths: Path[]) => {
    setDrawings(prev => ({...prev, [pageId]: newPaths}));
  }, []);

  const handleSave = () => {
    if (!broadcastDate) {
      alert('방송일을 선택해주세요.');
      return;
    }
    const scriptKey = getScriptKey(broadcastDate);
    const manifestStr = localStorage.getItem(SCRIPT_MANIFEST_KEY);
    let manifest: ScriptManifestItem[] = manifestStr ? JSON.parse(manifestStr) : [];
  
    if (manifest.some(item => item.date === broadcastDate)) {
      if (!window.confirm('같은 날짜에 저장된 스크립트가 있습니다. 덮어쓰시겠습니까?')) {
        return;
      }
      manifest = manifest.filter(item => item.date !== broadcastDate);
    }
  
    const dataToSave: SavedScriptData = { broadcastDate, broadcastTopic, pages, drawings };
    localStorage.setItem(scriptKey, JSON.stringify(dataToSave));
    
    const newManifest = [...manifest, { date: broadcastDate, topic: broadcastTopic }];
    newManifest.sort((a, b) => b.date.localeCompare(a.date));
    localStorage.setItem(SCRIPT_MANIFEST_KEY, JSON.stringify(newManifest));
    
    alert('데이터가 저장되었습니다.');
  };

  const handleExportData = () => {
    try {
        const dataToExport: SavedScriptData = { broadcastDate, broadcastTopic, pages, drawings };
        const jsonString = JSON.stringify(dataToExport, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const fileName = `${broadcastDate || 'script'}_${broadcastTopic || 'broadcast'}.json`;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error("Failed to export data:", error);
        alert("데이터를 내보내는 중 오류가 발생했습니다.");
    }
  };
  
  const handleLoadFromFile = () => {
    fileInputRef.current?.click();
  };
  
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result;
        if (typeof text !== 'string') {
          throw new Error('File content is not a string.');
        }
        const data: SavedScriptData = JSON.parse(text);

        // Basic validation
        if (data.broadcastDate && data.pages && Array.isArray(data.pages)) {
          setBroadcastDate(data.broadcastDate);
          setBroadcastTopic(data.broadcastTopic || '');
          setPages(normalizePageStyles(data.pages));
          setDrawings(data.drawings || {});
          setCurrentPageIndex(0);
          alert('데이터를 성공적으로 불러왔습니다.');
        } else {
          throw new Error('Invalid file format.');
        }
      } catch (error) {
        console.error('Failed to load script from file:', error);
        alert('파일을 불러오는데 실패했습니다. 파일 형식이 올바른지 확인해주세요.');
      } finally {
        // Reset file input value to allow loading the same file again
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    };
    reader.onerror = () => {
        alert('파일을 읽는 중 오류가 발생했습니다.');
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
    };
    reader.readAsText(file);
  };

  const handleLoadScript = (date: string) => {
    const scriptKey = getScriptKey(date);
    const dataStr = localStorage.getItem(scriptKey);
    if (dataStr) {
      const data: SavedScriptData = JSON.parse(dataStr);
      setBroadcastDate(data.broadcastDate);
      setBroadcastTopic(data.broadcastTopic);
      setPages(normalizePageStyles(data.pages));
      setDrawings(data.drawings || {});
      setIsListModalOpen(false);
      setCurrentPageIndex(0);
      alert(`${date} 스크립트를 불러왔습니다.`);
    } else {
      alert('데이터를 불러오는데 실패했습니다.');
    }
  };

  const handleDeleteScript = (date: string) => {
      const scriptKey = getScriptKey(date);
      localStorage.removeItem(scriptKey);

      const manifestStr = localStorage.getItem(SCRIPT_MANIFEST_KEY);
      let manifest: ScriptManifestItem[] = manifestStr ? JSON.parse(manifestStr) : [];
      const newManifest = manifest.filter(item => item.date !== date);
      localStorage.setItem(SCRIPT_MANIFEST_KEY, JSON.stringify(newManifest));
  };

  const handlePrint = (mode: 'current' | 'all') => {
    setPrintMode(mode);
  };

   const handleNewScript = () => {
    if (window.confirm('현재 내용을 기반으로 새 스크립트를 만드시겠습니까? 날짜와 주제가 초기화됩니다.')) {
        setBroadcastDate(new Date().toISOString().split('T')[0]);
        setBroadcastTopic('');
        setCurrentPageIndex(0);
        localStorage.removeItem(AUTOSAVE_KEY);
        alert('새 스크립트 준비가 완료되었습니다. 날짜와 주제를 확인하고 저장하세요.');
    }
  };

  const handleSaveAsPdf = async () => {
    setIsLoading(true);
    setLoadingMessage('PDF 파일을 생성하고 있습니다. 잠시만 기다려주세요...');
    
    const printContainer = document.querySelector('.print-container') as HTMLElement;
    if (!printContainer) {
        alert('PDF를 생성할 컨텐츠를 찾을 수 없습니다.');
        setIsLoading(false);
        return;
    }
    
    const originalDisplay = printContainer.style.display;
    printContainer.style.display = 'block';

    try {
        const pagesToPrint = printContainer.querySelectorAll('.print-page');
        const pdf = new jspdf.jsPDF({
            orientation: 'p',
            unit: 'mm',
            format: 'a4'
        });
        const pdfWidth = 210;
        const pdfHeight = 297;

        for (let i = 0; i < pagesToPrint.length; i++) {
            setLoadingMessage(`페이지 ${i + 1}/${pagesToPrint.length} 처리 중...`);
            const pageElement = pagesToPrint[i] as HTMLElement;
            
            const canvas = await html2canvas(pageElement, {
                scale: 2,
                useCORS: true
            });
            const imgData = canvas.toDataURL('image/png');
            
            if (i > 0) {
                pdf.addPage();
            }
            
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        }
        
        const fileName = `${broadcastDate || 'script'}_${broadcastTopic || 'broadcast'}.pdf`;
        pdf.save(fileName);
    } catch (error) {
        console.error("PDF 생성 중 오류 발생:", error);
        alert("PDF를 생성하는 동안 오류가 발생했습니다.");
    } finally {
        printContainer.style.display = originalDisplay;
        setIsLoading(false);
        setLoadingMessage('');
    }
  };

  useEffect(() => {
    if (printMode) {
      window.print();
    }
  }, [printMode]);

  useEffect(() => {
    const afterPrint = () => {
        setPrintMode(null);
    }
    window.addEventListener('afterprint', afterPrint);
    return () => window.removeEventListener('afterprint', afterPrint);
  }, []);

  const currentPageData = pages[currentPageIndex];
  const currentPageDrawings = drawings[currentPageData?.id] || [];

  return (
    <>
       {isLoading && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 no-print">
            <div className="bg-white p-6 rounded-lg shadow-xl flex flex-col items-center">
                <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-indigo-600 mb-4"></div>
                <p className="text-lg font-semibold text-gray-800">{loadingMessage}</p>
            </div>
        </div>
      )}
      <div className="min-h-screen bg-gray-100 flex flex-col items-center p-4 sm:p-6 lg:p-8">
        <header className="mb-4 text-center no-print">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-800 tracking-tight">
            방송은 나의 기쁨
          </h1>
        </header>

        <Toolbar
          onNewScript={handleNewScript}
          onSave={handleSave}
          onExport={handleExportData}
          onLoad={handleLoadFromFile}
          onOpenList={() => setIsListModalOpen(true)}
          onPrint={handlePrint}
          onSaveAsPdf={handleSaveAsPdf}
          isEditMode={isEditMode}
          onToggleEditMode={toggleEditMode}
        />
        
        <div className="w-full max-w-5xl p-4 mb-4 bg-white rounded-lg shadow-md no-print">
            <div className="flex flex-wrap items-center gap-4 md:gap-6">
                <div className="flex items-center gap-2">
                    <label htmlFor="broadcast-date" className="font-semibold text-gray-700 shrink-0">방송일:</label>
                    <input 
                        type="date" 
                        id="broadcast-date" 
                        value={broadcastDate} 
                        onChange={(e) => setBroadcastDate(e.target.value)} 
                        className="p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                    />
                </div>
                <div className="flex items-center gap-2 flex-grow min-w-[200px]">
                    <label htmlFor="broadcast-topic" className="font-semibold text-gray-700 shrink-0">주제:</label>
                    <input 
                        type="text" 
                        id="broadcast-topic" 
                        value={broadcastTopic} 
                        onChange={(e) => setBroadcastTopic(e.target.value)} 
                        placeholder="방송 주제를 입력하세요..."
                        className="p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 w-full"
                    />
                </div>
            </div>
        </div>


        <main className="w-full bg-gray-100">
          <Pagination
            currentPage={currentPageIndex + 1}
            totalPages={pages.length}
            onPrev={goToPrevPage}
            onNext={goToNextPage}
          />
          {currentPageData && (
            <div className={`${printMode === 'all' ? 'hidden' : 'block'}`}>
              <PageViewer 
                  page={currentPageData} 
                  onTextChange={handleTextChange} 
                  onFieldUpdate={handleFieldUpdate}
                  onLayoutUpdate={handleLayoutUpdate}
                  paths={currentPageDrawings}
                  onPathsChange={(newPaths) => handlePathsChange(currentPageData.id, newPaths)}
                  tool={tool}
                  setTool={setTool}
                  penColor={penColor}
                  setPenColor={setPenColor}
                  penWidth={penWidth}
                  setPenWidth={setPenWidth}
                  isCurrentPage={true}
                  isEditMode={isEditMode}
                  onPrev={goToPrevPage}
                  onNext={goToNextPage}
              />
            </div>
          )}
           <div className="mt-4">
            <Pagination
                currentPage={currentPageIndex + 1}
                totalPages={pages.length}
                onPrev={goToPrevPage}
                onNext={goToNextPage}
            />
          </div>
        </main>
        <footer className="mt-8 text-center text-gray-500 text-sm no-print">
          <p>A tool for simple radio script editing.</p>
        </footer>
      </div>

       <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".json"
        style={{ display: 'none' }}
      />

       {/* Print-only view for "All Pages" */}
      <div className="hidden print-container">
        {pages.map(page => (
            <div key={page.id} className="w-full max-w-4xl mx-auto">
                <div className="relative w-full shadow-2xl rounded-lg overflow-hidden print-page" style={{ aspectRatio: '1 / 1.414' }}>
                    <PageViewer
                        page={page}
                        onTextChange={() => {}}
                        onFieldUpdate={() => {}}
                        onLayoutUpdate={() => {}}
                        paths={drawings[page.id] || []}
                        onPathsChange={() => {}}
                        tool={'select'}
                        setTool={() => {}}
                        penColor={penColor}
                        setPenColor={() => {}}
                        penWidth={penWidth}
                        setPenWidth={() => {}}
                        isCurrentPage={false}
                        isEditMode={false}
                        onPrev={() => {}}
                        onNext={() => {}}
                    />
                </div>
            </div>
        ))}
      </div>
      <ScriptListModal
        isOpen={isListModalOpen}
        onClose={() => setIsListModalOpen(false)}
        onLoadScript={handleLoadScript}
        onDeleteScript={handleDeleteScript}
       />
    </>
  );
}

export default App;