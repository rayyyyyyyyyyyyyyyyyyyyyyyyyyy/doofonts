import { useState } from 'react';
import axios from 'axios';
import Header from './components/Header';
import UploadZone from './components/UploadZone';
import ModelSelector from './components/ModelSelector';
import ResultsPanel from './components/ResultsPanel';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

function App() {
  const [page, setPage] = useState('upload');
  const [model, setModel] = useState('convnext-v2');
  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadedImage, setUploadedImage] = useState(null); // preview URL
  const [error, setError] = useState(null);
  const [timingInfo, setTimingInfo] = useState(null);

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

  const handleImageSelected = async (file) => {
    const previewUrl = URL.createObjectURL(file);
    setUploadedImage(previewUrl);
    setPage('results');
    setIsLoading(true);
    setResults(null);
    setError(null);
    setTimingInfo(null);

    try {
      const data = await callPredictAPI(file);
      setResults(data.predictions);
      setTimingInfo({
        inference_time_ms: data.inference_time_ms,
        total_time_ms: data.total_time_ms,
      });
    } catch (err) {
      console.error('Prediction error:', err);
      setError(
        err.response?.data?.detail ||
        'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบว่า Backend กำลังทำงานอยู่'
      );
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    setPage('upload');
    setResults(null);
    setIsLoading(false);
    setError(null);
    setTimingInfo(null);
  };

  const handleSampleClick = async (sample) => {
    setUploadedImage(sample.src);
    setPage('results');
    setIsLoading(true);
    setResults(null);
    setError(null);
    setTimingInfo(null);

    try {
      // Fetch sample image as a File object so we can send it to the API
      const response = await fetch(sample.src);
      const blob = await response.blob();
      const file = new File([blob], `${sample.name}.png`, { type: 'image/png' });

      const data = await callPredictAPI(file);
      setResults(data.predictions);
      setTimingInfo({
        inference_time_ms: data.inference_time_ms,
        total_time_ms: data.total_time_ms,
      });
    } catch (err) {
      console.error('Sample prediction error:', err);
      setError(
        err.response?.data?.detail ||
        'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบว่า Backend กำลังทำงานอยู่'
      );
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <div className="App">
      <Header />

      {page === 'results' && (
        <main className="results-page">
          <ResultsPanel
            results={results}
            isLoading={isLoading}
            uploadedImage={uploadedImage}
            onBack={handleBack}
            model={model}
            error={error}
            timingInfo={timingInfo}
          />
        </main>
      )}

      {page === 'upload' && (
        <main className="upload-page">
          <div className="upload-hero">
            <h1 className="upload-title">Identify</h1>
            <p className="upload-subtitle">Find fonts from any image in seconds</p>
          </div>
          <ModelSelector selectedModel={model} onModelChange={setModel} />
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
