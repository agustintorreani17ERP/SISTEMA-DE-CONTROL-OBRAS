import React, { useState } from "react";
import {
  Building2,
  Plus,
  Search,
  Trash2,
  Edit2,
  AlertCircle,
  X,
  Phone,
  Mail,
  MapPin,
  Tag,
} from "lucide-react";
import { Partner } from "../types";
import { api } from "../api";

interface SuppliersListTabProps {
  partners: Partner[];
  onRefresh: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export const SuppliersListTab: React.FC<SuppliersListTabProps> = ({
  partners,
  onRefresh,
  showToast,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
  const [partnerToDelete, setPartnerToDelete] = useState<Partner | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [formState, setFormState] = useState({
    name: "",
    taxId: "",
    kind: "SUPPLIER" as "SUPPLIER" | "SUBCONTRACTOR" | "BOTH",
    fiscalAddress: "",
    phone: "",
    email: "",
    classification: "MATERIALES",
  });

  const suppliers = partners.filter((p) => p.kind === "SUPPLIER" || p.kind === "BOTH");

  const filteredSuppliers = suppliers.filter((s) => {
    const q = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.taxId.toLowerCase().includes(q) ||
      (s.classification || "").toLowerCase().includes(q) ||
      (s.email || "").toLowerCase().includes(q)
    );
  });

  const handleOpenCreate = () => {
    setFormState({
      name: "",
      taxId: "",
      kind: "SUPPLIER",
      fiscalAddress: "",
      phone: "",
      email: "",
      classification: "MATERIALES",
    });
    setShowCreateModal(true);
  };

  const handleOpenEdit = (p: Partner) => {
    setEditingPartner(p);
    setFormState({
      name: p.name,
      taxId: p.taxId,
      kind: p.kind,
      fiscalAddress: p.fiscalAddress || "",
      phone: p.phone || "",
      email: p.email || "",
      classification: p.classification || "MATERIALES",
    });
  };

  const handleSavePartner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.name.trim() || !formState.taxId.trim()) {
      showToast("El RUC y el nombre comercial son obligatorios", "error");
      return;
    }

    setSubmitting(true);
    try {
      if (editingPartner) {
        await api.updatePartner(editingPartner.id, {
          name: formState.name.trim(),
          taxId: formState.taxId.trim(),
          kind: formState.kind,
          fiscalAddress: formState.fiscalAddress.trim(),
          phone: formState.phone.trim(),
          email: formState.email.trim(),
          classification: formState.classification.trim().toUpperCase(),
        });
        showToast("Proveedor actualizado exitosamente");
        setEditingPartner(null);
      } else {
        await api.createPartner({
          name: formState.name.trim(),
          taxId: formState.taxId.trim(),
          kind: formState.kind,
          fiscalAddress: formState.fiscalAddress.trim(),
          phone: formState.phone.trim(),
          email: formState.email.trim(),
          classification: formState.classification.trim().toUpperCase(),
        });
        showToast("Proveedor registrado exitosamente");
        setShowCreateModal(false);
      }
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al guardar el proveedor", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeletePartner = async () => {
    if (!partnerToDelete) return;
    setSubmitting(true);
    try {
      await api.deletePartner(partnerToDelete.id);
      showToast(`Proveedor ${partnerToDelete.name} eliminado`);
      setPartnerToDelete(null);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || "Error al eliminar proveedor", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white border border-slate-200 p-4 rounded-2xl shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-bold text-slate-900">Directorio de Proveedores</h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
              {suppliers.length} proveedores registrados
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Administrá todos los proveedores de insumos, materiales y servicios comerciales vinculados a la obra.
          </p>
        </div>

        <button
          onClick={handleOpenCreate}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Nuevo Proveedor</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="bg-white border border-slate-200 p-3 rounded-2xl shadow-xs flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Buscar por razón social, RUC o rubro..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 transition"
          />
        </div>

        <span className="text-xs text-slate-500">
          Mostrando <strong className="text-slate-900">{filteredSuppliers.length}</strong> de {suppliers.length}
        </span>
      </div>

      {/* Suppliers Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto max-h-[560px] overflow-y-auto scrollbar-thin">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200 sticky top-0 z-10">
              <tr>
                <th className="p-3 w-28">RUC / TAX ID</th>
                <th className="p-3">RAZÓN SOCIAL / NOMBRE</th>
                <th className="p-3 text-center">TIPO</th>
                <th className="p-3 text-center">CLASIFICACIÓN</th>
                <th className="p-3">CONTACTO / TELÉFONO</th>
                <th className="p-3">CORREO ELECTRÓNICO</th>
                <th className="p-3 text-center w-28">ACCIONES</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
              {filteredSuppliers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    No se encontraron proveedores. Hacé clic en "Nuevo Proveedor" para agregar.
                  </td>
                </tr>
              ) : (
                filteredSuppliers.map((s) => (
                  <tr key={s.id} className="hover:bg-blue-50/30 transition">
                    <td className="p-3 font-mono font-bold text-blue-700 whitespace-nowrap">
                      {s.taxId}
                    </td>
                    <td className="p-3">
                      <p className="font-bold text-slate-900 leading-tight">{s.name}</p>
                      {s.fiscalAddress && (
                        <p className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-slate-400" />
                          <span>{s.fiscalAddress}</span>
                        </p>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                        {s.kind === "BOTH" ? "PROVEEDOR / SUBCONTRATISTA" : "PROVEEDOR"}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                        {s.classification || "MATERIALES"}
                      </span>
                    </td>
                    <td className="p-3 text-slate-600">
                      {s.phone ? (
                        <span className="flex items-center gap-1 font-mono">
                          <Phone className="w-3 h-3 text-slate-400" />
                          {s.phone}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="p-3 text-slate-600">
                      {s.email ? (
                        <span className="flex items-center gap-1 font-mono">
                          <Mail className="w-3 h-3 text-slate-400" />
                          {s.email}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="p-3 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => handleOpenEdit(s)}
                          title="Modificar Proveedor"
                          className="p-1.5 rounded-lg bg-slate-50 hover:bg-blue-50 text-blue-600 hover:text-blue-800 border border-slate-200 transition cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setPartnerToDelete(s)}
                          title="Eliminar Proveedor"
                          className="p-1.5 rounded-lg bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Create or Edit Supplier */}
      {(showCreateModal || editingPartner) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative">
            <button
              onClick={() => {
                setShowCreateModal(false);
                setEditingPartner(null);
              }}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <Building2 className="w-5 h-5 text-blue-600" />
              <h3 className="text-base font-bold text-slate-900">
                {editingPartner ? "Modificar Proveedor" : "Registrar Nuevo Proveedor"}
              </h3>
            </div>

            <form onSubmit={handleSavePartner} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">RUC / Cédula Fiscal *</label>
                  <input
                    type="text"
                    required
                    value={formState.taxId}
                    onChange={(e) => setFormState({ ...formState, taxId: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:border-blue-500 outline-none"
                    placeholder="Ej. 80012345-6"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Clasificación / Rubro</label>
                  <input
                    type="text"
                    value={formState.classification}
                    onChange={(e) => setFormState({ ...formState, classification: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:border-blue-500 outline-none"
                    placeholder="Ej. HORMIGÓN, CANTERA, HIERROS"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Razón Social / Nombre Comercial *</label>
                <input
                  type="text"
                  required
                  value={formState.name}
                  onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:border-blue-500 outline-none"
                  placeholder="Ej. Hormigones del Paraguay S.A."
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Dirección Fiscal / Planta</label>
                <input
                  type="text"
                  value={formState.fiscalAddress}
                  onChange={(e) => setFormState({ ...formState, fiscalAddress: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:border-blue-500 outline-none"
                  placeholder="Ej. Ruta 2 Km 28, Capiatá"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Teléfono de Contacto</label>
                  <input
                    type="text"
                    value={formState.phone}
                    onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:border-blue-500 outline-none"
                    placeholder="Ej. 021 500 123"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Correo Electrónico</label>
                  <input
                    type="email"
                    value={formState.email}
                    onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:border-blue-500 outline-none"
                    placeholder="ventas@proveedor.com.py"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setEditingPartner(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
                >
                  {submitting ? "Guardando..." : editingPartner ? "Guardar Cambios" : "Crear Proveedor"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {partnerToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm p-5 shadow-2xl">
            <div className="flex items-center gap-2 text-rose-600 mb-2">
              <AlertCircle className="w-5 h-5" />
              <h3 className="text-base font-bold text-slate-900">¿Eliminar Proveedor?</h3>
            </div>
            <p className="text-xs text-slate-600 mb-4">
              ¿Estás seguro de que querés borrar a <strong>{partnerToDelete.name}</strong>? Se conservarán los registros históricos de compras.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPartnerToDelete(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                disabled={submitting}
                onClick={handleDeletePartner}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
              >
                {submitting ? "Borrando..." : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
