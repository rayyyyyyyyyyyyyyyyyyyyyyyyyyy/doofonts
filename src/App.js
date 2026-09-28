import { useState } from 'react';
import axios from 'axios';
import Header from './components/Header';
import UploadZone from './components/UploadZone';
import ModelSelector from './components/ModelSelector';
import ResultsPanel from './components/ResultsPanel';
import CompareResultsPanel from './components/CompareResultsPanel';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const MAX_PREVIEW_WORDS = 50;

function limitPreviewWords(text) {
  if (typeof Intl?.Segmenter !== 'undefined') {
    const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
    let wordCount = 0;

    for (const segment of segmenter.segment(text)) {
      if (!segment.isWordLike) continue;
      wordCount += 1;
      if (wordCount > MAX_PREVIEW_WORDS) {
        return text.slice(0, segment.index).trimEnd();
      }
    }
    return text;
  }

  // Fallback for browsers without Intl.Segmenter.
  const words = text.trim().split(/\s+/);
  return words.length <= MAX_PREVIEW_WORDS
    ? text
    : words.slice(0, MAX_PREVIEW_WORDS).join(' ');
}

function App() {
  const [page, setPage] = useState('upload');
  const [model, setModel] = useState('convnext-v2');
  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadedImage, setUploadedImage] = useState(null); // preview URL
  const [error, setError] = useState(null);
  const [timingInfo, setTimingInfo] = useState(null);
  const [ocrResult, setOcrResult] = useState(null);
  const [recognizedText, setRecognizedText] = useState('');

  // Compare-all mode
  const [compareMode, setCompareMode] = useState(false);
  const [modelResults, setModelResults] = useState(null);

  const callPredictAPI = async (imageFile) => {
    const formData = new FormData();
    formData.append('file', imageFile);

    const response = await axios.post(
      `${API_URL}/api/predict?model=${model}&top_k=3`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );

    return response.data;
  };

  const callPredictAllAPI = async (imageFile) => {
    const formData = new FormData();
    formData.append('file', imageFile);

    const response = await axios.post(
      `${API_URL}/api/predict-all?top_k=3`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );

    return response.data;
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
    setRecognizedText(limitPreviewWords(text));
  };

  const handleImageSelected = async (file) => {
    const previewUrl = URL.createObjectURL(file);
    setUploadedImage(previewUrl);
    setPage('results');
    setIsLoading(true);
    resetState();

    try {
      if (compareMode) {
        const data = await callPredictAllAPI(file);
        setModelResults(data.model_results);
        setOcrResult(data.ocr || null);
        setRecognizedText(data.ocr?.text || '');
        setTimingInfo({
          inference_time_ms: data.inference_time_ms,
          total_time_ms: data.total_time_ms,
        });
      } else {
        const data = await callPredictAPI(file);
        setResults(data.predictions);
        setOcrResult(data.ocr || null);
        setRecognizedText(data.ocr?.text || '');
        setTimingInfo({
          inference_time_ms: data.inference_time_ms,
          total_time_ms: data.total_time_ms,
        });
      }
    } catch (err) {
      console.error('Prediction error:', err);
      setError(
        err.response?.data?.detail ||
        'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบว่า Backend กำลังทำงานอยู่'
      );
      if (!compareMode) setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    setPage('upload');
    setIsLoading(false);
    resetState();
  };

  const handleSampleClick = async (sample) => {
    setUploadedImage(sample.src);
    setPage('results');
    setIsLoading(true);
    resetState();

    try {
      // Fetch sample image as a File object so we can send it to the API
      const response = await fetch(sample.src);
      const blob = await response.blob();
      const file = new File([blob], `${sample.name}.png`, { type: 'image/png' });

      if (compareMode) {
        const data = await callPredictAllAPI(file);
        setModelResults(data.model_results);
        setOcrResult(data.ocr || null);
        setRecognizedText(data.ocr?.text || '');
        setTimingInfo({
          inference_time_ms: data.inference_time_ms,
          total_time_ms: data.total_time_ms,
        });
      } else {
        const data = await callPredictAPI(file);
        setResults(data.predictions);
        setOcrResult(data.ocr || null);
        setRecognizedText(data.ocr?.text || '');
        setTimingInfo({
          inference_time_ms: data.inference_time_ms,
          total_time_ms: data.total_time_ms,
        });
      }
    } catch (err) {
      console.error('Sample prediction error:', err);
      setError(
        err.response?.data?.detail ||
        'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบว่า Backend กำลังทำงานอยู่'
      );
      if (!compareMode) setResults([]);
    } finally {
      setIsLoading(false);
    }
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

          {/* Compare mode toggle */}
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
              Compare All 5 Models
            </button>
          </div>

          {!compareMode && (
            <ModelSelector selectedModel={model} onModelChange={setModel} />
          )}
          {compareMode && (
            <div className="compare-hint">
              ทดสอบทั้ง 5 โมเดลพร้อมกัน แสดงผลเปรียบเทียบ
            </div>
          )}

          <UploadZone onImageSelected={handleImageSelected} />

          <div className="sample-section">
            <p className="sample-label">Or try a sample image:</p>
            <div className="sample-images">
              {[
                { src: '/samples/Charmonman.png', name: 'Charmonman' },
                { src: '/samples/Google Sans.png', name: 'Google Sans' },
                { src: '/samples/Kanit.png', name: 'Kanit' },
              ].map((sample) => (
                <div
                  key={sample.name}
                  className="sample-card"
                  onClick={() => handleSampleClick(sample)}
                >
                  <div className="sample-img-wrapper">
                    <img src={sample.src} alt={sample.name} className="sample-thumb" />
                  </div>
                  <span className="sample-name">{sample.name}</span>
                </div>
              ))}
            </div>
          </div>
        </main>
      )}

    </div>
  );
}

export default App;
