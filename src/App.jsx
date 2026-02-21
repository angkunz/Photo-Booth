import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, Download, RefreshCcw, Settings, Upload, Trash2, X, Image as ImageIcon, CloudUpload, Maximize, Minimize, CheckCircle, AlertCircle } from 'lucide-react';

// === ตั้งค่า Google Apps Script Web App URL ที่นี่ ===
// นำ URL ที่ได้จากการ Deploy ของ Google Apps Script มาใส่ในเครื่องหมายคำพูดด้านล่างนี้
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby3tcyMQ8Zp86KIxrOyIrienhE0CnRb4UYTo1nxbz6_m5V6IlBzH0gG-rA5IRxlPooD/exec";

// --- Helper Functions ---
// สร้างกรอบรูปแบบ Default โดยใช้ SVG (แบบเจาะช่องใส 3 ช่อง)
const generateDefaultFrame = (id, name, bgColor, textColor, text) => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="1400">
        <path d="M0,0 h600 v1400 h-600 Z M50,50 v350 h500 v-350 Z M50,450 v350 h500 v-350 Z M50,850 v350 h500 v-350 Z" fill="${bgColor}" fill-rule="evenodd" />
        <text x="300" y="1320" font-family="sans-serif" font-size="48" font-weight="bold" fill="${textColor}" text-anchor="middle" letter-spacing="4">${text}</text>
    </svg>
  `;
  return {
    id,
    name,
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    isCustom: false
  };
};

const DEFAULT_FRAMES = [
  generateDefaultFrame('classic-white', 'คลาสสิก', '#FFFFFF', '#000000', 'PHOTOBOOTH'),
  generateDefaultFrame('dark-mode', 'ดาร์กโหมด', '#1A1A1A', '#FFFFFF', 'MEMORIES'),
  generateDefaultFrame('cute-pink', 'พิงค์กี้', '#FFB6C1', '#FFFFFF', 'CUTE SNAP'),
];

export default function PhotoBooth() {
  // --- States ---
  const [stream, setStream] = useState(null);
  const [frames, setFrames] = useState(DEFAULT_FRAMES);
  const [selectedFrameId, setSelectedFrameId] = useState(DEFAULT_FRAMES[0].id);
  const [mode, setMode] = useState('idle'); // idle, capturing, processing, result
  const [photos, setPhotos] = useState([]);
  const [countdown, setCountdown] = useState(null);
  const [flash, setFlash] = useState(false);
  const [finalImage, setFinalImage] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [notification, setNotification] = useState({ show: false, type: '', message: '' });
  
  // Admin States
  const [showAdmin, setShowAdmin] = useState(false);
  const [driveFolderId, setDriveFolderId] = useState('');

  // Refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null); // Hidden canvas for processing
  const resultCanvasRef = useRef(null); // Canvas for final composition

  // --- Initialize Camera & LocalStorage ---
  useEffect(() => {
    // Load custom frames from local storage
    const savedFrames = localStorage.getItem('photobooth_custom_frames');
    if (savedFrames) {
      try {
        setFrames([...DEFAULT_FRAMES, ...JSON.parse(savedFrames)]);
      } catch (e) {
        console.error("Failed to parse custom frames", e);
      }
    }
    
    // Load Drive settings
    const savedFolderId = localStorage.getItem('photobooth_drive_folder_id');
    if (savedFolderId) setDriveFolderId(savedFolderId);

    // Listen for fullscreen changes
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    // Start Camera
    const startCamera = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        console.error("Error accessing camera: ", err);
        setNotification({ show: true, type: 'error', message: 'ไม่สามารถเข้าถึงกล้องได้ กรุณาตรวจสอบสิทธิ์การใช้งาน' });
      }
    };

    startCamera();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Make sure video connects to stream if component re-renders
  useEffect(() => {
    if (videoRef.current && stream && !videoRef.current.srcObject) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, mode]);

  // --- Fullscreen Toggle Logic ---
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  // --- Core Logic: Capturing Photos ---
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const startCaptureProcess = async () => {
    setMode('capturing');
    setPhotos([]);
    const capturedPhotos = [];

    for (let i = 0; i < 3; i++) {
      // Countdown
      for (let c = 3; c > 0; c--) {
        setCountdown(c);
        await sleep(1000);
      }
      setCountdown(null);
      
      // Flash effect
      setFlash(true);
      
      // Capture frame from video
      if (videoRef.current && canvasRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        
        // Target size for each photo hole (500x350)
        const tw = 500;
        const th = 350;
        canvas.width = tw;
        canvas.height = th;

        // Calculate aspect ratio to center-crop the video feed
        const videoRatio = video.videoWidth / video.videoHeight;
        const targetRatio = tw / th;
        
        let sWidth = video.videoWidth;
        let sHeight = video.videoHeight;
        let sx = 0;
        let sy = 0;

        if (videoRatio > targetRatio) {
          // Video is wider than target
          sWidth = video.videoHeight * targetRatio;
          sx = (video.videoWidth - sWidth) / 2;
        } else {
          // Video is taller than target
          sHeight = video.videoWidth / targetRatio;
          sy = (video.videoHeight - sHeight) / 2;
        }

        // Mirror the image horizontally so it acts like a mirror
        ctx.translate(tw, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, tw, th);
        
        // Reset transform
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        capturedPhotos.push(canvas.toDataURL('image/jpeg', 0.9));
        setPhotos([...capturedPhotos]);
      }

      setTimeout(() => setFlash(false), 150);
      await sleep(600); // Brief pause before next countdown
    }

    setMode('processing');
    processFinalImage(capturedPhotos);
  };

  // --- Core Logic: Merging Photos with Frame ---
  const processFinalImage = async (capturedPhotos) => {
    const canvas = resultCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Standard photo strip size (3 photos)
    canvas.width = 600;
    canvas.height = 1400;

    // Fill background with white (fallback)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Load and draw the 3 photos
    const photoPositions = [50, 450, 850]; // Y coordinates
    
    const drawImage = (src, x, y, w, h) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, x, y, w, h);
          resolve();
        };
        img.src = src;
      });
    };

    for (let i = 0; i < capturedPhotos.length; i++) {
      await drawImage(capturedPhotos[i], 50, photoPositions[i], 500, 350);
    }

    // Load and draw the selected frame overlay
    const selectedFrame = frames.find(f => f.id === selectedFrameId);
    if (selectedFrame) {
      await drawImage(selectedFrame.url, 0, 0, 600, 1400);
    }

    // Generate final output
    setFinalImage(canvas.toDataURL('image/png'));
    setMode('result');
  };

  const showSuccessAndReset = (message) => {
    setNotification({ show: true, type: 'success', message });
    setTimeout(() => {
      setNotification({ show: false, type: '', message: '' });
      resetBooth();
    }, 3000);
  };

  const handleDownloadAndUpload = async () => {
    if (!finalImage) return;
    
    // 1. Download Local
    const filename = `photobooth-${new Date().getTime()}.png`;
    const link = document.createElement('a');
    link.href = finalImage;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // 2. Upload to Drive if configured
    if (GOOGLE_SCRIPT_URL && GOOGLE_SCRIPT_URL !== "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE") {
      setIsUploading(true);
      
      // คลีนค่า Folder ID (ดึงมาเฉพาะ ID หากผู้ใช้เผลอใส่ URL แบบเต็มมา)
      let cleanFolderId = driveFolderId;
      if (cleanFolderId.includes('folders/')) {
        cleanFolderId = cleanFolderId.split('folders/')[1].split('?')[0];
      }

      try {
        // เปลี่ยนมาใช้วิธีส่งแบบ Form URL Encoded ป้องกันการถูกบล็อก CORS
        const formData = new URLSearchParams();
        formData.append('image', finalImage);
        formData.append('filename', filename);
        formData.append('folderId', cleanFolderId);

        const response = await fetch(GOOGLE_SCRIPT_URL, {
          method: 'POST',
          body: formData,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          }
        });

        const result = await response.json();
        
        if (result.success) {
          showSuccessAndReset('บันทึกรูปลงเครื่องและส่งไปยัง Google Drive สำเร็จ!');
        } else {
          setNotification({ show: true, type: 'error', message: 'เกิดข้อผิดพลาดจาก Google Drive: ' + result.error });
        }
      } catch (error) {
        console.error("Upload error:", error);
        setNotification({ show: true, type: 'error', message: 'บันทึกลงเครื่องสำเร็จ แต่ไม่สามารถเชื่อมต่อกับ Google Drive ได้' });
      } finally {
        setIsUploading(false);
      }
    } else {
      // กรณีไม่ได้ตั้งค่า URL ของ Google Script ไว้
      showSuccessAndReset('บันทึกรูปภาพลงเครื่องเรียบร้อยแล้ว!');
    }
  };

  const resetBooth = () => {
    setPhotos([]);
    setFinalImage(null);
    setMode('idle');
  };

  // --- Admin Functions ---
  const handleUploadCustomFrame = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // ย่อขนาดรูปภาพก่อนบันทึกเพื่อป้องกัน QuotaExceededError (บังคับขนาดมาตรฐาน 600x1400 สำหรับ 3 รูป)
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 600;
        tempCanvas.height = 1400;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(img, 0, 0, 600, 1400);
        
        // แปลงเป็น WebP คุณภาพ 80% (รองรับพื้นหลังใสและไฟล์เล็กกว่า PNG มาก)
        const compressedUrl = tempCanvas.toDataURL('image/webp', 0.8);

        const newFrame = {
          id: `custom-${Date.now()}`,
          name: file.name.replace(/\.[^/.]+$/, ""), // Remove extension
          url: compressedUrl,
          isCustom: true
        };

        const updatedFrames = [...frames, newFrame];
        const customFrames = updatedFrames.filter(f => f.isCustom);
        
        try {
          // พยายามบันทึกลง LocalStorage
          localStorage.setItem('photobooth_custom_frames', JSON.stringify(customFrames));
          setFrames(updatedFrames);
          setSelectedFrameId(newFrame.id);
        } catch (error) {
          console.error("Storage error:", error);
          if (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
            setNotification({ show: true, type: 'error', message: "พื้นที่เก็บข้อมูลเบราว์เซอร์เต็ม! (จำกัดประมาณ 5MB)\nกรุณาลบกรอบรูปเก่าออกก่อนทำการอัพโหลดใหม่" });
          } else {
            setNotification({ show: true, type: 'error', message: "เกิดข้อผิดพลาดในการบันทึกข้อมูล: " + error.message });
          }
        }
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const deleteCustomFrame = (id) => {
    const updatedFrames = frames.filter(f => f.id !== id);
    setFrames(updatedFrames);
    const customFrames = updatedFrames.filter(f => f.isCustom);
    
    try {
      localStorage.setItem('photobooth_custom_frames', JSON.stringify(customFrames));
    } catch (error) {
      console.error("Error updating storage:", error);
    }
    
    if (selectedFrameId === id) {
      setSelectedFrameId(DEFAULT_FRAMES[0].id);
    }
  };

  // --- Renderers ---
  return (
    <div className="fixed inset-0 w-full h-full bg-neutral-900 text-white font-sans overflow-hidden flex flex-col">
      {/* Hidden Canvases for processing */}
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={resultCanvasRef} className="hidden" />

      {/* Header */}
      <header className="p-4 flex justify-between items-center border-b border-neutral-800 bg-neutral-950 z-10 shrink-0">
        <div className="flex items-center gap-2">
          <Camera className="w-6 h-6 text-pink-500" />
          <h1 className="text-xl font-bold tracking-wider">PHOTO<span className="text-pink-500">BOOTH</span></h1>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={toggleFullscreen}
            className="p-2 rounded-full hover:bg-neutral-800 transition-colors"
            title={isFullscreen ? "ย่อหน้าจอ" : "เต็มหน้าจอ"}
          >
            {isFullscreen ? (
              <Minimize className="w-6 h-6 text-neutral-200 hover:text-white" />
            ) : (
              <Maximize className="w-6 h-6 text-neutral-200 hover:text-white" />
            )}
          </button>
          <button 
            onClick={() => setShowAdmin(true)}
            className="p-2 rounded-full hover:bg-neutral-800 transition-colors"
            title="จัดการระบบ (แอดมิน)"
          >
            <Settings className="w-6 h-6 text-neutral-200 hover:text-white" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 relative flex flex-col items-center justify-center p-4 overflow-y-auto custom-scrollbar">
        
        {/* Flash Overlay */}
        {flash && <div className="absolute inset-0 bg-white z-50 opacity-90 transition-opacity duration-100"></div>}

        {/* --- VIEW: Idle & Capturing (Camera) --- */}
        {(mode === 'idle' || mode === 'capturing') && (
          <div className="w-full max-w-6xl flex flex-col lg:flex-row items-center lg:items-stretch justify-center gap-6 lg:gap-10 my-auto">
            
            {/* Camera Viewfinder */}
            <div className="relative w-full max-w-lg md:max-w-2xl lg:max-w-4xl aspect-[4/3] bg-black rounded-2xl overflow-hidden shadow-2xl border-4 border-neutral-800 shrink-0 my-auto">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className="w-full h-full object-cover transform -scale-x-100" // Mirrored
              />
              
              {/* Capture Progress Indicators */}
          <div className="absolute top-4 right-4 flex gap-2">
            {[0, 1, 2].map((index) => (
              <div 
                key={index} 
                className={`w-3 h-3 rounded-full border border-white/50 transition-colors ${
                  photos.length > index ? 'bg-pink-500 border-pink-500' : 'bg-black/50'
                }`}
              />
            ))}
          </div>

              {/* Countdown Overlay */}
              {countdown !== null && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm">
                  <span className="text-9xl font-bold text-white drop-shadow-lg animate-pulse">
                    {countdown}
                  </span>
                </div>
              )}
            </div>

            {/* Controls */}
            {mode === 'idle' && (
              <div className="w-full lg:w-96 flex flex-col items-center gap-4 md:gap-6 shrink-0 bg-neutral-900/50 lg:bg-neutral-800/40 lg:p-6 rounded-3xl lg:border border-neutral-700/50 my-auto">
                {/* Frame Selector */}
            <div className="w-full flex flex-col items-center">
              <p className="text-center text-neutral-400 mb-2 md:mb-4 text-sm font-medium uppercase tracking-widest">เลือกกรอบรูป</p>
              <div className="w-full flex lg:grid lg:grid-cols-2 gap-4 md:gap-6 overflow-x-auto lg:overflow-x-hidden lg:overflow-y-auto pb-4 lg:pb-2 justify-center px-4 no-scrollbar lg:custom-scrollbar items-end lg:items-start lg:content-start h-48 md:h-64 lg:h-[50vh]">
                {frames.map(frame => (
                  <button
                    key={frame.id}
                    onClick={() => setSelectedFrameId(frame.id)}
                    className={`flex-shrink-0 flex flex-col items-center gap-2 md:gap-3 transition-all duration-300 ${
                      selectedFrameId === frame.id ? 'transform scale-110 lg:scale-105 opacity-100 z-10' : 'opacity-60 hover:opacity-90 hover:scale-105'
                    }`}
                  >
                    <div className={`w-20 h-40 md:w-28 md:h-56 lg:w-28 lg:h-56 xl:w-32 xl:h-64 rounded-xl overflow-hidden border-4 ${
                      selectedFrameId === frame.id ? 'border-pink-500 shadow-[0_0_25px_rgba(236,72,153,0.6)]' : 'border-neutral-700 shadow-lg'
                    }`}>
                      {/* เปลี่ยน object-cover เป็น object-contain เพื่อแสดงภาพได้เต็มทั้งภาพไม่ถูกตัดขอบ */}
                      <img src={frame.url} alt={frame.name} className="w-full h-full object-contain bg-neutral-800" />
                    </div>
                    <span className={`text-xs md:text-sm whitespace-nowrap ${selectedFrameId === frame.id ? 'text-pink-400 font-bold' : 'text-neutral-300'}`}>
                      {frame.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <button 
                  onClick={startCaptureProcess}
                  className="bg-pink-600 hover:bg-pink-500 text-white rounded-full w-16 h-16 md:w-20 md:h-20 flex items-center justify-center shadow-lg shadow-pink-500/30 transition-transform active:scale-95 border-4 border-white/20 shrink-0 mt-2 lg:mt-4"
                >
                  <Camera className="w-8 h-8 text-white" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* --- VIEW: Processing --- */}
        {mode === 'processing' && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-pink-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xl font-medium tracking-wide animate-pulse">กำลังประมวลผลรูปภาพ...</p>
          </div>
        )}

        {/* --- VIEW: Result --- */}
        {mode === 'result' && finalImage && (
          <div className="flex flex-col md:flex-row items-center justify-center gap-8 w-full max-w-4xl h-full">
            
            {/* Preview Image */}
            <div className="relative group bg-neutral-800 p-2 rounded-xl shadow-2xl">
              <img 
                src={finalImage} 
                alt="Final Photobooth" 
                className="max-h-[65vh] md:max-h-[75vh] w-auto object-contain rounded-lg"
              />
            </div>

            {/* Actions */}
        <div className="flex flex-row md:flex-col gap-4">
          <button 
            onClick={handleDownloadAndUpload}
            disabled={isUploading}
            className={`flex items-center gap-3 px-6 py-4 rounded-xl font-bold transition-all shadow-lg ${
              isUploading ? 'bg-neutral-600 text-white cursor-not-allowed' : 'bg-white text-black hover:bg-neutral-200'
            }`}
          >
            {isUploading ? <RefreshCcw className="w-6 h-6 animate-spin text-white" /> : <Download className="w-6 h-6 text-black" />}
            <span className={isUploading ? 'text-white' : 'text-black'}>{isUploading ? 'กำลังอัพโหลด...' : 'ดาวน์โหลดรูปภาพ'}</span>
          </button>
          
          <button 
            onClick={resetBooth}
            className="flex items-center gap-3 bg-neutral-800 text-white px-6 py-4 rounded-xl font-bold hover:bg-neutral-700 border border-neutral-700 transition-colors"
          >
            <RefreshCcw className="w-6 h-6 text-white" />
            <span className="text-white">ถ่ายใหม่อีกครั้ง</span>
          </button>
        </div>
      </div>
    )}
    </main>

    {/* --- Admin Modal (Upload Custom Frames & Settings) --- */}
    {showAdmin && (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl">
          
          <div className="flex justify-between items-center p-6 border-b border-neutral-800 bg-neutral-950">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Settings className="text-pink-500" /> ระบบจัดการกรอบรูป (Admin)
            </h2>
            <button onClick={() => setShowAdmin(false)} className="text-neutral-400 hover:text-white">
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto max-h-[70vh] custom-scrollbar">
          
          {/* Google Drive Settings Section */}
          <div className="mb-8 bg-neutral-900/50 p-5 rounded-xl border border-neutral-700">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-300 mb-4 flex items-center gap-2">
              <CloudUpload className="w-4 h-4" /> ตั้งค่าบันทึกลง Google Drive
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">Google Drive Folder ID</label>
                <input 
                  type="text" 
                  value={driveFolderId}
                  onChange={(e) => {
                    setDriveFolderId(e.target.value);
                    localStorage.setItem('photobooth_drive_folder_id', e.target.value);
                  }}
                  placeholder="ใส่ ID โฟลเดอร์ที่ต้องการเก็บรูป (เว้นว่างไว้จะเก็บที่ My Drive)"
                  className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-pink-500 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Upload Section */}
          <div className="mb-8">
            <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-neutral-700 border-dashed rounded-xl cursor-pointer hover:bg-neutral-800 transition-colors bg-neutral-900/50">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <Upload className="w-10 h-10 mb-3 text-neutral-400" />
                <p className="mb-2 text-sm text-neutral-400"><span className="font-semibold text-white">คลิกเพื่ออัพโหลด</span> หรือลากไฟล์มาวาง</p>
                <p className="text-xs text-neutral-500">รองรับไฟล์ PNG พื้นหลังใส (ขนาดที่กำหนด: 600x1400 px สำหรับ 3 รูป)</p>
              </div>
              <input type="file" accept="image/png" className="hidden" onChange={handleUploadCustomFrame} />
            </label>
          </div>

          {/* Manage Frames List */}
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-500 mb-4 flex items-center gap-2">
                  <ImageIcon className="w-4 h-4" /> กรอบรูปที่มีอยู่ในระบบ
                </h3>
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                  {frames.map(frame => (
                    <div key={frame.id} className="relative group bg-neutral-800 rounded-lg p-2 border border-neutral-700">
                      <div className="aspect-[1/3] w-full rounded bg-neutral-900 mb-2 overflow-hidden flex items-center justify-center">
                        <img src={frame.url} alt={frame.name} className="w-full h-full object-contain" />
                      </div>
                      <p className="text-xs text-center text-neutral-300 truncate px-1">{frame.name}</p>
                      
                      {/* Delete button only for custom frames */}
                      {frame.isCustom && (
                        <button 
                          onClick={() => deleteCustomFrame(frame.id)}
                          className="absolute top-2 right-2 bg-red-500/80 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                          title="ลบกรอบรูป"
                        >
                          <Trash2 className="w-4 h-4 text-white" />
                        </button>
                      )}
                      {!frame.isCustom && (
                        <div className="absolute top-2 right-2 bg-neutral-600/50 px-2 py-0.5 rounded text-[10px] text-neutral-300">
                          ระบบ
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            
            <div className="p-4 bg-neutral-950 border-t border-neutral-800 flex justify-end">
              <button 
                onClick={() => setShowAdmin(false)}
                className="px-6 py-2 bg-pink-600 hover:bg-pink-500 text-white rounded-lg font-medium transition-colors"
              >
                เสร็จสิ้น
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Notification Modal --- */}
      {notification.show && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-700 rounded-3xl p-8 max-w-sm w-full shadow-2xl flex flex-col items-center text-center transform transition-all scale-100">
            {notification.type === 'success' ? (
              <>
                <div className="bg-green-500/20 p-4 rounded-full mb-4">
                  <CheckCircle className="w-16 h-16 text-green-500" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">สำเร็จ!</h3>
                <p className="text-neutral-300">{notification.message}</p>
              </>
            ) : (
              <>
                <div className="bg-red-500/20 p-4 rounded-full mb-4">
                  <AlertCircle className="w-16 h-16 text-red-500" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">พบปัญหา</h3>
                <p className="text-neutral-300 mb-8 whitespace-pre-line">{notification.message}</p>
                <button
                  onClick={() => setNotification({ show: false, type: '', message: '' })}
                  className="w-full py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold transition-colors shadow-lg shadow-red-500/20"
                >
                  ตกลง
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Basic inline CSS for custom scrollbar */}
      <style dangerouslySetInnerHTML={{__html: `
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #171717; rounded: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #404040; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #525252; }
      `}} />
    </div>
  );
}