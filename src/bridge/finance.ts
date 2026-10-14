/**
 * Puente ECMS → ERP: lo que los certificados y la planilla de RRHH usan del ERP para generar
 * asientos, conciliar facturas y pedir fondos. Único punto por donde ECMS toca al ERP.
 */
export { EVENTO, postAsientoDesdeRegla } from "../erp/domain/contabilidad";
export { evaluateMatch } from "../erp/domain/threeWayMatch";
export { solicitudDesdeCertificacion, solicitudDesdeCertificadoSubcontrato, anularSolicitudPorOrigen } from "../erp/domain/fondos";
