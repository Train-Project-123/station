"use client";

import React, { useState } from "react";
import Image from "next/image";
import { 
  Download, 
  Ticket
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleDownload = () => {
    setDownloading(true);
    setProgress(0);
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setDownloading(false);
          const link = document.createElement('a');
          link.href = 'https://expo.dev/artifacts/eas/xjGPg4o4jbTUVFMYFY6nxP.apk';
          link.setAttribute('download', 'Thirakkundo.apk');
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          return 100;
        }
        return prev + 10;
      });
    }, 80);
  };

  return (
    <div className="min-h-screen bg-[#fdfbf7] text-[#1e1b4b] font-serif antialiased selection:bg-indigo-200">
      
      {/* VINTAGE HEADER */}
      <nav className="border-b-4 border-double border-[#1e1b4b] bg-[#fdfbf7] sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-[#1e1b4b] bg-white flex items-center justify-center p-1 shadow-[4px_4px_0px_#1e1b4b]">
              <Image src="/favicon.png" alt="Logo" width={400} height={400} />
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-black text-2xl tracking-tighter uppercase italic">Thirakkundo</span>
              <span className="text-[10px] font-mono font-bold uppercase tracking-widest opacity-60">Est. 2026 · Railway Infra</span>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-24 md:py-32">
        
        {/* TICKET HERO - THE PRIMARY FOCUS */}
        <section className="relative border-4 border-[#1e1b4b] p-8 md:p-16 bg-white shadow-[12px_12px_0px_#1e1b4b] mb-32 overflow-hidden">
          <div className="absolute top-0 bottom-0 left-[-10px] flex flex-col justify-around">
            {[...Array(10)].map((_, i) => <div key={i} className="w-5 h-5 bg-[#fdfbf7] rounded-full border-r-2 border-[#1e1b4b]" />)}
          </div>
          <div className="absolute top-0 bottom-0 right-[-10px] flex flex-col justify-around">
            {[...Array(10)].map((_, i) => <div key={i} className="w-5 h-5 bg-[#fdfbf7] rounded-full border-l-2 border-[#1e1b4b]" />)}
          </div>

          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-10">
                <Ticket className="w-6 h-6 rotate-45" />
                <span className="text-xs font-mono font-black uppercase tracking-[0.3em] bg-indigo-100 px-3 py-1 border border-indigo-200">First Class Build</span>
            </div>
            
            <h1 className="text-5xl md:text-8xl font-black mb-10 tracking-tighter leading-none uppercase italic border-b-2 border-[#1e1b4b] pb-8 text-center md:text-left">
              Railway <br /> <span className="text-indigo-600">Companion.</span>
            </h1>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-end">
              <p className="text-xl md:text-2xl leading-relaxed max-w-md italic opacity-80 text-center md:text-left">
                Precision instrument for the modern commuter. Station detection & live manifest tracking.
              </p>
              <div className="flex flex-col items-center md:items-end gap-6">
                <Button 
                  className={`h-16 px-12 rounded-none font-black text-sm uppercase tracking-[0.25em] transition-all shadow-[6px_6px_0px_#1e1b4b] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_#1e1b4b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0px_#1e1b4b] ${
                    downloading ? "bg-zinc-100 text-zinc-400" : "bg-indigo-600 text-white"
                  }`}
                  onClick={handleDownload}
                  disabled={downloading}
                >
                  {downloading ? `Processing ${progress}%` : "Download Android APK"}
                </Button>
                <span className="text-[10px] font-mono font-black uppercase tracking-widest text-indigo-900/60 font-bold tracking-widest">Serial No: THRK-2026-V1.4</span>
              </div>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
