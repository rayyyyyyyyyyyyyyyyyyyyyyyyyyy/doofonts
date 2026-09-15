import { useState } from 'react';
import Header from './components/Header';
import UploadZone from './components/UploadZone';
import ModelSelector from './components/ModelSelector';
import ResultsPanel from './components/ResultsPanel';
import './App.css';

function App() {
  const [page, setPage] = useState('upload');
  const [model, setModel] = useState('convnext-v2');
  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadedImage, setUploadedImage] = useState(null); // เก็บ preview URL

  const handleImageSelected = async (file) => {
    const previewUrl = URL.createObjectURL(file);
    setUploadedImage(previewUrl);
    setPage('results');       // สลับไปหน้า results ทันที
    setIsLoading(true);
    setResults(null);
    // TODO: เรียก API
    // const data = await identifyFont(file, model);
    // setResults(data);
    // setIsLoading(false);
  };

  const handleBack = () => {
    setPage('upload');
    setResults(null);
    setIsLoading(false);
  };

  const handleSampleClick = async (sampleUrl) => {
    setUploadedImage(sampleUrl);
    setPage('results');
    setIsLoading(true);
    setResults(null);
    // TODO: fetch sample แล้วส่งเข้า API เหมือน handleImageSelected
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
                  onClick={() => handleSampleClick(sample.src)}
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
