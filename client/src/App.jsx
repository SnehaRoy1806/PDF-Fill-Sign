import React, { useState, useRef, useEffect } from 'react';
import { Worker, Viewer } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import { Type, ImageIcon, Calendar, CheckCircle, PenTool, Save, Menu, Move, Trash2, UploadCloud } from 'lucide-react';

import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';

const pdfjsVersion = '3.0.279'; 
const workerUrl = `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/build/pdf.worker.min.js`;

export default function App() {
  const defaultLayoutPluginInstance = defaultLayoutPlugin();
  
  // --- STATE ---
  const [pdfFile, setPdfFile] = useState(null); // Determines which screen to show
  const [fields, setFields] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  
  const dragItem = useRef(null); 
  const fieldsRef = useRef(fields); 
  useEffect(() => { fieldsRef.current = fields; }, [fields]);

  // --- 1. HANDLE UPLOAD (Swaps UI on SAME TAB) ---
  const onFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type === "application/pdf") {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        setPdfFile(reader.result); // React will re-render and show the Editor immediately
      };
    } else {
      alert("Please select a valid PDF file.");
    }
  };

  const addField = (type) => {
    const id = Date.now();
    let width = 20; let height = 5; let value = ""; 
    if (type === 'Radio') { width = 5; height = 3; }
    if (type === 'Date') { width = 15; height = 4; value = new Date().toISOString().split('T')[0]; }
    if (type === 'Image') { width = 25; height = 15; }
    if (type === 'Signature') { width = 20; height = 8; }
    
    const newField = { id, type, x: 35, y: 10, width, height, value };
    setFields([...fields, newField]);
    setSelectedId(id);
  };

  const updateFieldValue = (id, val) => setFields(prev => prev.map(f => f.id === id ? { ...f, value: val } : f));
  const deleteField = (id) => { setFields(prev => prev.filter(f => f.id !== id)); setSelectedId(null); };
  
  const handleImageUpload = (e, id) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setFields(prev => prev.map(f => f.id === id ? { ...f, value: reader.result } : f));
      reader.readAsDataURL(file);
    }
  };

  // --- 2. SAVE PDF (Opens Result in NEW TAB) ---
  const handleSavePdf = async () => {
    try {
      const payload = {
        pdfBase64: pdfFile, 
        fields: fields 
      };

      // Use the Environment Variable if it exists, otherwise fallback to localhost
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

      const response = await fetch(`${API_URL}/api/sign-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (data.success) {
        // This opens a NEW TAB with the signed PDF
        window.open(data.url, '_blank'); 
        console.log("Audit Trail:", data.auditTrail);
      } else {
        alert("Server Error: " + data.error);
      }
    } catch (err) { alert("Failed to connect to backend."); }
  };

  // --- DRAG LOGIC ---
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!dragItem.current) return;
      const { id, action, startX, startY, initialX, initialY, initialW, initialH, pageWidth, pageHeight } = dragItem.current;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      if (e.touches) e.preventDefault(); 

      const deltaX = clientX - startX;
      const deltaY = clientY - startY;
      const deltaXPercent = (deltaX / pageWidth) * 100;
      const deltaYPercent = (deltaY / pageHeight) * 100;

      setFields(prev => prev.map(f => {
        if (f.id !== id) return f;
        if (action === 'move') {
          return { ...f, x: Math.min(Math.max(initialX + deltaXPercent, 0), 100 - f.width), y: Math.min(Math.max(initialY + deltaYPercent, 0), 100 - f.height) };
        } else {
          return { ...f, width: Math.max(initialW + deltaXPercent, 5), height: Math.max(initialH + deltaYPercent, 2) };
        }
      }));
    };
    const handleUp = () => { dragItem.current = null; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMouseMove, { passive: false });
    window.addEventListener('touchend', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, []); 

  const handleMouseDown = (e, fieldId, action) => {
    e.stopPropagation(); setSelectedId(fieldId);
    const field = fields.find(f => f.id === fieldId);
    const pageLayer = e.target.closest('.rpv-core__page-layer');
    if (!field || !pageLayer) return;
    const rect = pageLayer.getBoundingClientRect();
    dragItem.current = {
      id: fieldId, action,
      startX: e.touches ? e.touches[0].clientX : e.clientX,
      startY: e.touches ? e.touches[0].clientY : e.clientY,
      initialX: field.x, initialY: field.y, initialW: field.width, initialH: field.height,
      pageWidth: rect.width, pageHeight: rect.height
    };
  };

  const renderPage = (props) => (
    <>
        {props.canvasLayer.children}
        {props.textLayer.children}
        {props.annotationLayer.children}
        <div className="absolute inset-0 z-10" onMouseDown={() => setSelectedId(null)} onTouchStart={() => setSelectedId(null)}>
          {fields.map((field) => (
            <div key={field.id} onMouseDown={(e) => { e.stopPropagation(); setSelectedId(field.id); }} onTouchStart={(e) => { e.stopPropagation(); setSelectedId(field.id); }}
              className={`absolute transition-all ${selectedId === field.id ? 'ring-2 ring-blue-500 z-50 bg-white/50' : 'bg-white/30 hover:bg-white/50'}`}
              style={{ left: `${field.x}%`, top: `${field.y}%`, width: `${field.width}%`, height: `${field.height}%` }}>
              
              {selectedId === field.id && (
                <>
                    <div className="absolute -top-4 -left-4 w-8 h-8 bg-blue-500 rounded-full text-white flex items-center justify-center cursor-move shadow-md z-50" style={{ touchAction: 'none' }} onMouseDown={(e) => handleMouseDown(e, field.id, 'move')} onTouchStart={(e) => handleMouseDown(e, field.id, 'move')}><Move size={14} /></div>
                    <div className="absolute -top-4 -right-4 w-8 h-8 bg-red-500 rounded-full text-white flex items-center justify-center cursor-pointer shadow-md hover:bg-red-600 z-50" onMouseDown={(e) => { e.stopPropagation(); deleteField(field.id); }} onTouchStart={(e) => { e.stopPropagation(); deleteField(field.id); }}><Trash2 size={14} /></div>
                    <div className="absolute bottom-0 right-0 w-8 h-8 cursor-nwse-resize flex items-end justify-end p-1 z-50" style={{ touchAction: 'none' }} onMouseDown={(e) => handleMouseDown(e, field.id, 'resize')} onTouchStart={(e) => handleMouseDown(e, field.id, 'resize')}><div className="w-3 h-3 bg-blue-500 rounded-sm shadow-sm border border-white"></div></div>
                </>
              )}

              {field.type === 'Text' && <textarea className="w-full h-full p-2 bg-transparent resize-none outline-none text-xs md:text-sm leading-tight text-gray-800" placeholder="Type..." value={field.value} onChange={(e) => updateFieldValue(field.id, e.target.value)} />}
              {field.type === 'Image' && <div className="w-full h-full relative border border-dashed border-gray-400 flex flex-col items-center justify-center overflow-hidden">{field.value ? <img src={field.value} className="w-full h-full object-contain" /> : <ImageIcon className="w-6 h-6 text-gray-400" />}<input type="file" accept="image/*" className={`absolute inset-0 w-full h-full opacity-0 cursor-pointer ${selectedId === field.id ? 'pointer-events-auto' : 'pointer-events-none'}`} onChange={(e) => handleImageUpload(e, field.id)} /></div>}
              {field.type === 'Signature' && <div className="w-full h-full relative bg-yellow-50/20 border-b border-black flex flex-col items-center justify-end overflow-hidden">{field.value ? <img src={field.value} className="w-full h-full object-contain pb-1" /> : <span className="text-gray-400 text-sm md:text-xl pb-1" style={{ fontFamily: 'cursive' }}>Sign Here</span>}<input type="file" accept="image/*" className={`absolute inset-0 w-full h-full opacity-0 cursor-pointer ${selectedId === field.id ? 'pointer-events-auto' : 'pointer-events-none'}`} onChange={(e) => handleImageUpload(e, field.id)} /></div>}
              {field.type === 'Date' && <input type="date" className="w-full h-full bg-transparent outline-none text-xs" value={field.value} onChange={(e) => updateFieldValue(field.id, e.target.value)} />}
              {field.type === 'Radio' && <div className="w-full h-full flex items-center justify-center border border-gray-400 bg-white" onClick={() => updateFieldValue(field.id, !field.value)}>{field.value && <div className="w-[70%] h-[70%] bg-black"></div>}</div>}
            </div>
          ))}
        </div>
    </>
  );

  // --- SCREEN 1: UPLOAD (CONDITIONAL RENDER) ---
  if (!pdfFile) {
    return (
      <div className="h-screen w-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-10 rounded-xl shadow-xl border border-gray-200 text-center max-w-md w-full">
          <div className="bg-blue-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
            <UploadCloud size={40} className="text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Upload Document</h1>
          <p className="text-gray-500 mb-8 text-sm">Select a PDF file to start signing and editing.</p>
          <label className="block w-full cursor-pointer bg-black text-white font-bold py-3 px-6 rounded-lg hover:bg-gray-800 transition-colors">
            Choose PDF File
            <input type="file" accept="application/pdf" className="hidden" onChange={onFileChange} />
          </label>
        </div>
      </div>
    );
  }

  // --- SCREEN 2: EDITOR (CONDITIONAL RENDER) ---
  return (
    <div className="flex flex-col lg:flex-row h-screen w-screen bg-gray-100 overflow-hidden font-sans">
      <style>{`@media (max-width: 1024px) { .rpv-toolbar { display: none !important; } }`}</style>
      <aside className="shrink-0 z-20 bg-white border-b lg:border-b-0 lg:border-r border-gray-200 shadow-sm flex flex-row lg:flex-col items-center lg:items-stretch justify-start w-full h-16 lg:w-64 lg:h-full p-2 lg:p-4 gap-2 lg:gap-4 overflow-x-auto lg:overflow-y-auto no-scrollbar">
        <div className="hidden lg:flex items-center gap-2 mb-2 px-2 text-gray-700"><Menu className="w-5 h-5" /><span className="font-bold text-lg">Editor</span></div>
        <div className="flex flex-row lg:flex-col gap-2">
          <ToolButton icon={<PenTool size={18} />} label="Signature" onClick={() => addField("Signature")} />
          <ToolButton icon={<Type size={18} />} label="Text" onClick={() => addField("Text")} />
          <ToolButton icon={<ImageIcon size={18} />} label="Image" onClick={() => addField("Image")} />
          <ToolButton icon={<Calendar size={18} />} label="Date" onClick={() => addField("Date")} />
          <ToolButton icon={<CheckCircle size={18} />} label="Radio" onClick={() => addField("Radio")} />
        </div>
        <div className="lg:flex-1"></div>
        <button onClick={handleSavePdf} className="hidden min-[450px]:flex items-center justify-center gap-2 bg-black text-white px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors shadow-lg active:scale-95 whitespace-nowrap ml-auto lg:ml-0"><Save size={18} /><span className="hidden lg:inline font-medium">Save PDF</span></button>
      </aside>
      <main className="flex-1 relative flex flex-col bg-gray-100/50 overflow-hidden">
        <div className="flex-1 overflow-auto p-4 lg:p-8 flex justify-center items-start pb-24" onMouseDown={() => setSelectedId(null)}>
          <div className="bg-white shadow-xl border border-gray-200 w-full max-w-3xl relative" onMouseDown={(e) => e.stopPropagation()}>
            <Worker workerUrl={workerUrl}>
               <Viewer fileUrl={pdfFile} plugins={[defaultLayoutPluginInstance]} defaultScale={1} renderPage={renderPage} />
            </Worker>
          </div>
        </div>
        <div className="fixed bottom-6 left-0 right-0 z-50 flex justify-center min-[450px]:hidden pointer-events-none">
          <button onClick={handleSavePdf} className="pointer-events-auto shadow-2xl bg-black text-white px-8 py-3 rounded-full flex items-center gap-3 font-bold active:scale-95 transition-transform"><Save size={20} />Save PDF</button>
        </div>
      </main>
    </div>
  );
}

function ToolButton({ icon, label, onClick }) { return (<button onClick={onClick} className="group flex items-center justify-center lg:justify-start gap-3 p-2.5 rounded-lg border border-transparent hover:bg-white hover:border-gray-200 hover:shadow-sm hover:text-blue-600 text-gray-600 transition-all active:scale-95 w-auto lg:w-full min-w-10 shrink-0"><span className="text-gray-500 group-hover:text-blue-600">{icon}</span><span className="hidden lg:inline text-sm font-medium">{label}</span></button>); }