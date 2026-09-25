import React, { useState } from "react";
import { Camera, X, Trash2, Plus, Image, Calendar, MessageSquare, ExternalLink } from "lucide-react";
import { ItemPhoto } from "../../types";

interface ItemPhotoModalProps {
  isOpen: boolean;
  onClose: () => void;
  rubroCode: string;
  rubroName: string;
  photos: ItemPhoto[];
  onSavePhotos: (photos: ItemPhoto[]) => void;
  readOnly?: boolean;
}

export const ItemPhotoModal: React.FC<ItemPhotoModalProps> = ({
  isOpen,
  onClose,
  rubroCode,
  rubroName,
  photos,
  onSavePhotos,
  readOnly = false,
}) => {
  const [photoList, setPhotoList] = useState<ItemPhoto[]>(photos);
  const [newUrl, setNewUrl] = useState("");
  const [newComment, setNewComment] = useState("");
  const [newDate, setNewDate] = useState(new Date().toISOString().split("T")[0]);
  const [selectedPreview, setSelectedPreview] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAddPhoto = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl.trim()) return;

    const newPhoto: ItemPhoto = {
      url: newUrl.trim(),
      comentario: newComment.trim() || undefined,
      fechaCaptura: newDate || new Date().toISOString(),
    };

    const updated = [...photoList, newPhoto];
    setPhotoList(updated);
    onSavePhotos(updated);

    setNewUrl("");
    setNewComment("");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        const newPhoto: ItemPhoto = {
          url: reader.result,
          comentario: `Evidencia fotográfica tomada en campo (${new Date().toLocaleDateString("es-PY")})`,
          fechaCaptura: new Date().toISOString(),
        };
        const updated = [...photoList, newPhoto];
        setPhotoList(updated);
        onSavePhotos(updated);
      }
    };
    reader.readAsDataURL(files[0]);
  };

  const handleDeletePhoto = (index: number) => {
    const updated = photoList.filter((_, i) => i !== index);
    setPhotoList(updated);
    onSavePhotos(updated);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                Evidencias Fotográficas de Campo
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">
                  {photoList.length} {photoList.length === 1 ? "foto" : "fotos"}
                </span>
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                {rubroCode} — {rubroName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Uploader Form (only if not readOnly) */}
          {!readOnly && (
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Agregar Nueva Evidencia
                </span>
                <label className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-white border border-blue-200 hover:border-blue-300 px-3 py-1.5 rounded-lg shadow-2xs transition-all">
                  <Camera className="w-3.5 h-3.5" />
                  Subir desde Dispositivo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </label>
              </div>

              <form onSubmit={handleAddPhoto} className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <input
                      type="url"
                      placeholder="O pega una URL de imagen (https://...)"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      className="w-full text-xs rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <input
                      type="date"
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                      className="w-full text-xs rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Comentario técnico / progresiva / eje (ej: Progresiva km 4+200 - Colado de losa)"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    className="flex-1 text-xs rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="submit"
                    disabled={!newUrl.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    Adjuntar
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Photo Gallery Grid */}
          {photoList.length === 0 ? (
            <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-xl p-6">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mx-auto mb-3">
                <Image className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-slate-600">No hay fotos registradas para este rubro</p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Las fotos respaldan la ejecución física para auditoría de fiscalización y aprobación tripartita.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {photoList.map((photo, idx) => (
                <div
                  key={idx}
                  className="group relative rounded-xl border border-slate-200 overflow-hidden bg-slate-50 shadow-2xs hover:shadow-md transition-shadow"
                >
                  <div
                    className="aspect-video w-full bg-slate-900 cursor-pointer overflow-hidden relative"
                    onClick={() => setSelectedPreview(photo.url)}
                  >
                    <img
                      src={photo.url}
                      alt={photo.comentario || `Evidencia ${idx + 1}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <span className="text-white text-xs font-medium flex items-center gap-1 bg-slate-900/80 px-2.5 py-1 rounded-full">
                        <ExternalLink className="w-3 h-3" /> Ver Ampliada
                      </span>
                    </div>
                  </div>

                  <div className="p-3 bg-white space-y-1.5 border-t border-slate-100">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {photo.fechaCaptura ? new Date(photo.fechaCaptura).toLocaleDateString("es-PY") : "Sin fecha"}
                      </span>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => handleDeletePhoto(idx)}
                          className="text-red-500 hover:text-red-700 p-1 rounded-sm hover:bg-red-50 transition-colors"
                          title="Eliminar foto"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {photo.comentario ? (
                      <p className="text-xs text-slate-700 font-medium line-clamp-2">
                        {photo.comentario}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-400 italic">Sin comentario</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg transition-colors shadow-2xs"
          >
            Listo ({photoList.length} {photoList.length === 1 ? "foto guardada" : "fotos guardadas"})
          </button>
        </div>
      </div>

      {/* Lightbox Preview */}
      {selectedPreview && (
        <div
          className="fixed inset-0 z-60 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setSelectedPreview(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] w-full flex items-center justify-center">
            <img
              src={selectedPreview}
              alt="Preview ampliado"
              className="max-h-[85vh] max-w-full object-contain rounded-lg shadow-2xl"
              referrerPolicy="no-referrer"
            />
            <button
              onClick={() => setSelectedPreview(null)}
              className="absolute top-2 right-2 bg-slate-800/80 hover:bg-slate-800 text-white p-2 rounded-full"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
