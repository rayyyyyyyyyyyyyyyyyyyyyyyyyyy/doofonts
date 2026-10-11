import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import Header from './components/Header';
import UploadZone from './components/UploadZone';
import ModelSelector from './components/ModelSelector';
import ResultsPanel from './components/ResultsPanel';
import CompareResultsPanel from './components/CompareResultsPanel';
import { MODELS } from './constants/models';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const MAX_PREVIEW_CHARACTERS = 50;
const TOP_K = 3;
const SERVER_ERROR_MESSAGE = 'Cannot connect to the server.';
const SAMPLES = [
  { src: '/samples/Charmonman.png', name: 'Charmonman' },
  { src: '/samples/Google Sans.png', name: 'Google Sans' },
  { src: '/samples/Kanit.png', name: 'Kanit' },
];

/** เตรียมข้อความแจ้งผู้ใช้ เมื่อเรียก API ไม่สำเร็จ */
function describeError(err) {
  // ถ้าเซิร์ฟเวอร์ไม่ตอบกลับ ให้แจ้งว่าเชื่อมต่อไม่ได้
  const serverUnreachable = axios.isAxiosError(err) && !err.response;
  const detail = err.response?.data?.detail;
  let message = serverUnreachable ? SERVER_ERROR_MESSAGE : (err.message || 'Prediction failed.');

  if (typeof detail === 'string' && detail) {
    message = detail;
  } else if (Array.isArray(detail)) {
    // ถ้า API แจ้งว่าข้อมูลไม่ถูกต้องหลายรายการ ให้รวมเป็นข้อความเดียว
    const messages = detail.map((item) => item?.msg).filter((msg) => typeof msg === 'string' && msg);
    if (messages.length) message = messages.join('; ');
  }

  return {
    message,
    serverUnreachable,
  };
}

async function postImage(endpoint, imageFile, params, signal) {
  const formData = new FormData();
  formData.append('file', imageFile);
  const response = await axios.post(`${API_URL}${endpoint}`, formData, { params, signal });
  return response.data;
}

async function fetchSampleFile(sample, signal) {
  const response = await fetch(sample.src, { signal });
  if (!response.ok) {
    throw new Error(`Could not load the sample image (HTTP ${response.status}).`);
  }
  const blob = await response.blob();
  return new File([blob], `${sample.name}.png`, { type: blob.type || 'image/png' });
}

/** จำกัด 50 ตัวอักษร โดยนับช่องว่าง สระ และวรรณยุกต์ด้วย */
function limitPreviewCharacters(text) {
  return Array.from(text).slice(0, MAX_PREVIEW_CHARACTERS).join('');
}

function App() {
  const [page, setPage] = useState('upload');
  const [model, setModel] = useState('convnext-v2');
  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadedImage, setUploadedImage] = useState(null); // URL รูปที่แสดงบนหน้าเว็บ
  const [error, setError] = useState(null); // ข้อความผิดพลาดและสถานะการเชื่อมต่อ
  const [timingInfo, setTimingInfo] = useState(null);
  const [ocrResult, setOcrResult] = useState(null);
  const [recognizedText, setRecognizedText] = useState('');

  // ข้อมูลสำหรับโหมดเปรียบเทียบทุกโมเดล
  const [compareMode, setCompareMode] = useState(false);
  const [modelResults, setModelResults] = useState(null);

  // รายชื่อโมเดลที่โหลดแล้ว; null คือยังไม่ได้รายชื่อจากเซิร์ฟเวอร์
  const [availableModels, setAvailableModels] = useState(null);

  // เก็บคำขอที่กำลังรอผลไว้ เพื่อยกเลิกเมื่อส่งรูปใหม่หรือกดย้อนกลับ
  const requestRef = useRef(null);

  // เลิกใช้ URL ชั่วคราวของรูปเก่า เพื่อคืนหน่วยความจำ
  useEffect(() => {
    if (!uploadedImage?.startsWith('blob:')) return undefined;
    return () => URL.revokeObjectURL(uploadedImage);
  }, [uploadedImage]);

  useEffect(() => {
    const controller = new AbortController();
    axios
      .get(`${API_URL}/api/models`, { signal: controller.signal })
      .then((response) => setAvailableModels(response.data.models))
      .catch(() => {}); // ถ้าโหลดรายชื่อไม่ได้ ให้ลองเลือกโมเดลและทำนายได้ตามเดิม
    return () => controller.abort();
  }, []);

  // ถ้าโมเดลที่เลือกไม่มีในรายชื่อ ให้เปลี่ยนเป็นโมเดลแรกที่โหลดแล้ว
  useEffect(() => {
    if (availableModels?.length && !availableModels.includes(model)) {
      setModel(availableModels[0]);
    }
  }, [availableModels, model]);

  const cancelPendingRequest = () => {
    requestRef.current?.abort();
    requestRef.current = null;
  };

  const resetState = () => {
    setResults(null);
    setError(null);
    setTimingInfo(null);
    setOcrResult(null);
    setRecognizedText('');
    setModelResults(null);
  };

  const handleRecognizedTextChange = (text) => {
    setRecognizedText(limitPreviewCharacters(text));
  };

  const runPrediction = async (previewUrl, loadFile) => {
    cancelPendingRequest();
    const controller = new AbortController();
    requestRef.current = controller;

    setUploadedImage(previewUrl);
    setPage('results');
    setIsLoading(true);
    resetState();

    try {
      const file = await loadFile(controller.signal);
      const data = compareMode
        ? await postImage('/api/predict-all', file, { top_k: TOP_K }, controller.signal)
        : await postImage('/api/predict', file, { model, top_k: TOP_K }, controller.signal);
      if (controller.signal.aborted) return;

      if (compareMode) {
        setModelResults(data.model_results);
      } else {
        setResults(data.predictions);
      }
      // ใช้ข้อความจากกรอบ OCR ที่ใหญ่ที่สุด แล้วจำกัดความยาวสำหรับแสดงตัวอย่าง
      setOcrResult(data.ocr || null);
      setRecognizedText(limitPreviewCharacters(data.ocr?.text || ''));
      setTimingInfo({
        ocr_time_ms: data.ocr_time_ms,
        inference_time_ms: data.inference_time_ms,
        total_time_ms: data.total_time_ms,
      });
    } catch (err) {
      // การยกเลิกคำขอไม่ใช่ข้อผิดพลาด จึงไม่ต้องแจ้งผู้ใช้
      if (controller.signal.aborted) return;
      console.error('Prediction error:', err);
      setError(describeError(err));
      if (!compareMode) setResults([]);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsLoading(false);
      }
    }
  };

  const handleImageSelected = (file) => {
    runPrediction(URL.createObjectURL(file), async () => file);
  };

  const handleSampleClick = (sample) => {
    runPrediction(sample.src, (signal) => fetchSampleFile(sample, signal));
  };

  const handleBack = () => {
    cancelPendingRequest();
    setPage('upload');
    setIsLoading(false);
    setUploadedImage(null);
    resetState();
  };

  return (
    <div className="App">
      <Header />

      {page === 'results' && !compareMode && (
        <main className="results-page">
          <ResultsPanel
            results={results}
            isLoading={isLoading}
            uploadedImage={uploadedImage}
            onBack={handleBack}
            model={model}
            error={error}
            timingInfo={timingInfo}
            ocrResult={ocrResult}
            recognizedText={recognizedText}
            onRecognizedTextChange={handleRecognizedTextChange}
          />
        </main>
      )}

      {page === 'results' && compareMode && (
        <main className="compare-page">
          <CompareResultsPanel
            modelResults={modelResults}
            isLoading={isLoading}
            uploadedImage={uploadedImage}
            onBack={handleBack}
            error={error}
            timingInfo={timingInfo}
            ocrResult={ocrResult}
            recognizedText={recognizedText}
            onRecognizedTextChange={handleRecognizedTextChange}
          />
        </main>
      )}

      {page === 'upload' && (
        <main className="upload-page">
          <div className="upload-hero">
            <h1 className="upload-title">Identify</h1>
            <p className="upload-subtitle">Find fonts from any image in seconds</p>
          </div>

          {/* เลือกโหมดโมเดลเดียวหรือเปรียบเทียบทุกโมเดล */}
          <div className="compare-toggle-wrapper">
            <button
              className={`compare-toggle-btn ${!compareMode ? 'active' : ''}`}
              onClick={() => setCompareMode(false)}
            >
              Single Model
            </button>
            <button
              className={`compare-toggle-btn ${compareMode ? 'active' : ''}`}
              onClick={() => setCompareMode(true)}
            >
              Compare All {MODELS.length} Models
            </button>
          </div>

          {!compareMode && (
            <ModelSelector
              selectedModel={model}
              onModelChange={setModel}
              availableModels={availableModels}
            />
          )}
          {compareMode && (
            <div className="compare-hint">
              Runs all {MODELS.length} models on the same image and shows the results side by side.
            </div>
          )}

          <UploadZone onImageSelected={handleImageSelected} />

          <div className="sample-section">
            <p className="sample-label">Or try a sample image:</p>
            <div className="sample-images">
              {SAMPLES.map((sample) => (
                <button
                  key={sample.name}
                  type="button"
                  className="sample-card"
                  onClick={() => handleSampleClick(sample)}
                >
                  <span className="sample-img-wrapper">
                    <img src={sample.src} alt="" className="sample-thumb" />
                  </span>
                  <span className="sample-name">{sample.name}</span>
                </button>
              ))}
            </div>
          </div>
        </main>
      )}

    </div>
  );
}

export default App;
