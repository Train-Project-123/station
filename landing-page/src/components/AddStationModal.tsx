"use client";

import React, { useState } from "react";
import { X, Train, Save, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "./ui/button";

interface AddStationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AddStationModal: React.FC<AddStationModalProps> = ({ isOpen, onClose }) => {
  const [formData, setFormData] = useState({
    stationName: "",
    stationCode: "",
    zone: "",
    division: "",
    state: "",
    latitude: "",
    longitude: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch("http://localhost:5000/api/stations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...formData,
          latitude: parseFloat(formData.latitude),
          longitude: parseFloat(formData.longitude),
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(true);
        setTimeout(() => {
          onClose();
          setSuccess(false);
          setFormData({
            stationName: "",
            stationCode: "",
            zone: "",
            division: "",
            state: "",
            latitude: "",
            longitude: "",
          });
        }, 2000);
      } else {
        setError(data.message || "Failed to add station");
      }
    } catch (err) {
      setError("Server error. Please make sure the backend is running.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#fdfbf7] border-4 border-[#1e1b4b] w-full max-w-lg shadow-[12px_12px_0px_#1e1b4b] relative overflow-hidden">
        {/* Header */}
        <div className="border-b-4 border-[#1e1b4b] bg-indigo-600 p-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Train className="w-5 h-5" />
            <h2 className="font-black uppercase tracking-widest text-sm">Add New Station</h2>
          </div>
          <button 
            onClick={onClose}
            className="text-white hover:rotate-90 transition-transform p-1"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border-2 border-red-500 p-3 flex items-center gap-3 text-red-700 text-xs font-bold uppercase">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 border-2 border-green-500 p-3 flex items-center gap-3 text-green-700 text-xs font-bold uppercase">
              <Save className="w-4 h-4 shrink-0" />
              Station added successfully!
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest opacity-60">Station Name</label>
              <input
                required
                name="stationName"
                value={formData.stationName}
                onChange={handleChange}
                placeholder="e.g. Kozhikode Main"
                className="w-full bg-white border-2 border-[#1e1b4b] p-2 text-sm focus:outline-none focus:ring-2 ring-indigo-500/20"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest opacity-60">Station Code</label>
              <div className="flex gap-2">
                <input
                  required
                  name="stationCode"
                  value={formData.stationCode}
                  onChange={handleChange}
                  placeholder="e.g. CLT"
                  className="flex-1 bg-white border-2 border-[#1e1b4b] p-2 text-sm focus:outline-none focus:ring-2 ring-indigo-500/20 uppercase"
                />
                <Button
                  type="button"
                  onClick={async () => {
                    if (!formData.stationCode) return;
                    setLoading(true);
                    try {
                      const res = await fetch(`http://localhost:5000/api/stations/${formData.stationCode}/live`);
                      const result = await res.json();
                      if (result.success && result.data.station) {
                        const s = result.data.station;
                        setFormData(prev => ({ 
                          ...prev, 
                          stationName: s.name || prev.stationName,
                          zone: s.zone || prev.zone,
                          division: s.division || prev.division,
                          state: s.state || prev.state,
                          latitude: s.coordinates?.lat?.toString() || prev.latitude,
                          longitude: s.coordinates?.lng?.toString() || prev.longitude,
                        }));
                        setSuccess(true);
                        setTimeout(() => setSuccess(false), 2000);
                      } else {
                        setError("Station details not found in RailRadar.");
                      }
                    } catch (err) {
                      setError("Failed to fetch station info.");
                    } finally {
                      setLoading(false);
                    }
                  }}
                  className="rounded-none bg-zinc-800 text-white text-[10px] px-3 h-10 border-2 border-[#1e1b4b] uppercase font-black"
                >
                  Fetch
                </Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest opacity-60">Zone</label>
              <input
                required
                name="zone"
                value={formData.zone}
                onChange={handleChange}
                placeholder="e.g. SR"
                className="w-full bg-white border-2 border-[#1e1b4b] p-2 text-sm focus:outline-none focus:ring-2 ring-indigo-500/20"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest opacity-60">Division</label>
              <input
                required
                name="division"
                value={formData.division}
                onChange={handleChange}
                placeholder="e.g. PGT"
                className="w-full bg-white border-2 border-[#1e1b4b] p-2 text-sm focus:outline-none focus:ring-2 ring-indigo-500/20"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest opacity-60">State</label>
              <input
                required
                name="state"
                value={formData.state}
                onChange={handleChange}
                placeholder="e.g. Kerala"
                className="w-full bg-white border-2 border-[#1e1b4b] p-2 text-sm focus:outline-none focus:ring-2 ring-indigo-500/20"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest opacity-60">Latitude</label>
              <input
                required
                type="number"
                step="any"
                name="latitude"
                value={formData.latitude}
                onChange={handleChange}
                placeholder="11.2486"
                className="w-full bg-white border-2 border-[#1e1b4b] p-2 text-sm focus:outline-none focus:ring-2 ring-indigo-500/20"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest opacity-60">Longitude</label>
              <input
                required
                type="number"
                step="any"
                name="longitude"
                value={formData.longitude}
                onChange={handleChange}
                placeholder="75.7844"
                className="w-full bg-white border-2 border-[#1e1b4b] p-2 text-sm focus:outline-none focus:ring-2 ring-indigo-500/20"
              />
            </div>
          </div>

          <div className="pt-4 flex gap-4">
            <Button
              type="button"
              onClick={onClose}
              variant="outline"
              className="flex-1 rounded-none border-2 border-[#1e1b4b] uppercase font-black tracking-widest text-xs"
            >
              Cancel
            </Button>
            <Button
              disabled={loading || success}
              type="submit"
              className="flex-1 rounded-none bg-indigo-600 text-white shadow-[4px_4px_0px_#1e1b4b] hover:shadow-[2px_2px_0px_#1e1b4b] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-none active:translate-x-[4px] active:translate-y-[4px] uppercase font-black tracking-widest text-xs disabled:opacity-50 disabled:translate-x-0 disabled:translate-y-0 disabled:shadow-[4px_4px_0px_#1e1b4b]"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </span>
              ) : (
                "Save Station"
              )}
            </Button>
          </div>
        </form>

        {/* Decorative elements */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-600" />
      </div>
    </div>
  );
};
