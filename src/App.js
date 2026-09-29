import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import Header from './components/Header';
import UploadZone from './components/UploadZone';
import ModelSelector from './components/ModelSelector';
import ResultsPanel from './components/ResultsPanel';
import CompareResultsPanel from './components/CompareResultsPanel';
import { MODELS } from './constants/models';
import { pickOcrPreview } from './utils/ocrPreview';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const MAX_PREVIEW_WORDS = 50;
const TOP_K = 3;
const SERVER_ERROR_MESSAGE = 'Cannot connect to the server.';
const SAMPLES = [
  { src: '/samples/Charmonman.png', name: 'Charmonman' },
  { src: '/samples/Google Sans.png', name: 'Google Sans' },
  { src: '/samples/Kanit.png', name: 'Kanit' },
];

/** Turn a failed request into { message, serverUnreachable } for the results panels. */
function describeError(err) {
  // No response at all means the backend is down or blocked (not a 4xx/5xx).
  const serverUnreachable = axios.isAxiosError(err) && !err.response;
  return {
    message:
      err.response?.data?.detail ||
      (serverUnreachable ? SERVER_ERROR_MESSAGE : err.message),
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
  const [error, setError] = useState(null); // { message, serverUnreachable }
  const [timingInfo, setTimingInfo] = useState(null);
  const [ocrResult, setOcrResult] = useState(null);
  const [recognizedText, setRecognizedText] = useState('');

  // Compare-all mode
  const [compareMode, setCompareMode] = useState(false);
  const [modelResults, setModelResults] = useState(null);

  // Model IDs the backend actually loaded (null until known / if unreachable).
  const [availableModels, setAvailableModels] = useState(null);

  // AbortController of the in-flight prediction, so a newer upload or "back"
  // can cancel it and its late response never overwrites current state.
  const requestRef = useRef(null);

  // Release the previous upload's blob URL once it is no longer displayed.
  useEffect(() => {
    if (!uploadedImage?.startsWith('blob:')) return undefined;
    return () => URL.revokeObjectURL(uploadedImage);
  }, [uploadedImage]);

  useEffect(() => {
    const controller = new AbortController();
    axios
      .get(`${API_URL}/api/models`, { signal: controller.signal })
      .then((response) => setAvailableModels(response.data.models))
      .catch(() => {}); // Backend down: keep every model selectable; predictions report the error.
    return () => controller.abort();
  }, []);

  // If the selected model failed to load on the server, fall back to one that did.
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
    setRecognizedText(limitPreviewWords(text));
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
      const ocrPreview = pickOcrPreview(data.ocr?.candidates);
      setOcrResult(ocrPreview);
      setRecognizedText(ocrPreview.text);
      setTimingInfo({
        ocr_time_ms: data.ocr_time_ms,
        inference_time_ms: data.inference_time_ms,
        total_time_ms: data.total_time_ms,
      });
    } catch (err) {
      // Cancelled by a newer request or by "back"; nothing to report.
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
