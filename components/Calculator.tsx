
import React, { useState } from 'react';

interface CalculatorProps {
  onClose: () => void;
}

const Calculator: React.FC<CalculatorProps> = ({ onClose }) => {
  const [val, setVal] = useState('');

  const num = parseInt(val) || 0;
  const packs = Math.floor(num / 18);
  const loose = num % 18;

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-zinc-900 border-2 border-yellow-400 rounded-3xl p-6 w-full max-w-sm shadow-[0_0_50px_rgba(250,204,21,0.2)]">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-black text-yellow-400">PACK CALCULATOR</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white font-bold text-xl px-2">✕</button>
        </div>

        <input 
          type="number"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="TOTAL ITEMS"
          autoFocus
          className="w-full bg-black border border-zinc-700 text-white text-5xl font-black text-center py-6 rounded-2xl mb-6 focus:outline-none focus:border-yellow-400 transition-colors"
        />

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-black/50 p-4 rounded-2xl text-center border border-white/5">
            <div className="text-5xl font-black text-green-500">{packs}</div>
            <div className="text-xs font-bold text-gray-500 uppercase mt-1">Full Packs</div>
          </div>
          <div className="bg-black/50 p-4 rounded-2xl text-center border border-white/5">
            <div className="text-5xl font-black text-yellow-500">{loose}</div>
            <div className="text-xs font-bold text-gray-500 uppercase mt-1">Loose Items</div>
          </div>
        </div>

        <button 
          onClick={onClose}
          className="w-full bg-yellow-400 text-black py-4 rounded-xl font-black text-lg active:scale-95 transition-all shadow-xl"
        >
          DONE
        </button>
      </div>
    </div>
  );
};

export default Calculator;
