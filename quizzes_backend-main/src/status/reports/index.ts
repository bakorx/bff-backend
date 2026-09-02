/**
 * Public barrel for the incident-reports submodule. Keeps the parent
 * `src/status/` directory clean — controllers/services/etc can `import` from
 * `./reports` directly without reaching into individual files.
 */
export {
  type IncidentReport,
  type IncidentReportInput,
  type IncidentReportList,
  type ReportSeverity,
} from "./interfaces";
export { IncidentReportModel } from "./models";
export { listReports, submitReport } from "./services";
export { getIncidentReports, postIncidentReport } from "./controllers";
export { reportsRouter } from "./routes";