export interface DriveFileRecord {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime?: string | null;
  md5Checksum?: string | null;
  webViewLink?: string | null;
  driveId?: string | null;
  trashed?: boolean;
}

export interface DriveFileListResult {
  files: DriveFileRecord[];
  nextPageToken?: string | null;
}

export interface DrivePort {
  getFileMetadata(fileId: string, fields?: string): Promise<DriveFileRecord>;
  listFiles(params: {
    q?: string;
    pageSize?: number;
    pageToken?: string;
    fields?: string;
    orderBy?: string;
  }): Promise<DriveFileListResult>;
  listChildren(parentId: string): Promise<DriveFileRecord[]>;
  downloadFile(fileId: string): Promise<Buffer>;
  exportFile(fileId: string, mimeType: string): Promise<Buffer>;
  bootstrapSandboxRootFolder(params: {
    parentId: string;
    name: string;
  }): Promise<DriveFileRecord>;
  createFolder(params: {
    name: string;
    parentId: string;
  }): Promise<DriveFileRecord>;
  createFile(params: {
    name: string;
    parentId: string;
    mimeType: string;
    body: Buffer | string;
    sourceMimeType?: string;
  }): Promise<DriveFileRecord>;
  updateFile(params: {
    fileId: string;
    name?: string;
    mimeType?: string;
    body?: Buffer | string;
    addParents?: string;
    removeParents?: string;
  }): Promise<DriveFileRecord>;
  copyFile(params: {
    sourceFileId: string;
    destinationParentId: string;
    name: string;
  }): Promise<DriveFileRecord>;
  deleteFile(fileId: string): Promise<void>;
  createAnyoneReaderPermission(fileId: string): Promise<{ permissionId: string }>;
  deletePermission(fileId: string, permissionId: string): Promise<void>;
}

export interface SheetsPort {
  getSpreadsheet(params: {
    spreadsheetId: string;
    ranges?: string[];
    includeGridData?: boolean;
    fields?: string;
  }): Promise<Record<string, unknown>>;
  getValues(params: {
    spreadsheetId: string;
    range: string;
    valueRenderOption?: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";
  }): Promise<unknown[][]>;
  updateValues(params: {
    spreadsheetId: string;
    range: string;
    values: unknown[][];
    valueInputOption?: "RAW" | "USER_ENTERED";
  }): Promise<void>;
  appendValues(params: {
    spreadsheetId: string;
    range: string;
    values: unknown[][];
    valueInputOption?: "RAW" | "USER_ENTERED";
  }): Promise<void>;
  batchUpdate(params: {
    spreadsheetId: string;
    requests: Record<string, unknown>[];
  }): Promise<Record<string, unknown>>;
  updateCellNote(params: {
    spreadsheetId: string;
    sheetId: number;
    rowIndex: number;
    columnIndex: number;
    note: string;
  }): Promise<void>;
  addChart(params: {
    spreadsheetId: string;
    spec: Record<string, unknown>;
  }): Promise<{ chartId: number | null }>;
}

export interface SlidesPort {
  getPresentation(presentationId: string): Promise<Record<string, unknown>>;
  batchUpdate(params: {
    presentationId: string;
    requests: Record<string, unknown>[];
  }): Promise<Record<string, unknown>>;
  duplicateSlide(params: {
    presentationId: string;
    sourceSlideId: string;
    newObjectId?: string;
    objectIdsMap?: Record<string, string>;
  }): Promise<{ duplicatedSlideId: string | null }>;
  replaceAllText(params: {
    presentationId: string;
    replacements: Array<{
      token: string;
      value: string;
      pageObjectIds?: string[];
    }>;
  }): Promise<void>;
  replaceShapesWithDriveImage(params: {
    presentationId: string;
    containsText: string;
    driveFileId: string;
    replaceMethod?: "CENTER_INSIDE" | "CENTER_CROP";
    pageObjectIds?: string[];
  }): Promise<{ applied: boolean; warning?: string }>;
  embedSheetsChart(params: {
    presentationId: string;
    pageObjectId: string;
    spreadsheetId: string;
    chartId: number;
    linkingMode?: "LINKED" | "NOT_LINKED_IMAGE";
    elementProperties?: Record<string, unknown>;
  }): Promise<void>;
  updateTableCells(params: {
    presentationId: string;
    tableObjectId: string;
    updates: Array<{ rowIndex: number; columnIndex: number; text: string }>;
  }): Promise<void>;
}

export interface GmailAttachmentDescriptor {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface GmailMessageDetail {
  id: string;
  threadId?: string | null;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  textBody: string;
  htmlBody: string;
  labelIds: string[];
  attachments: GmailAttachmentDescriptor[];
}

export interface GmailPort {
  listMessages(params: {
    q?: string;
    maxResults?: number;
    pageToken?: string;
    labelIds?: string[];
  }): Promise<{
    messages: Array<{ id: string; threadId?: string | null }>;
    nextPageToken?: string | null;
  }>;
  getMessage(messageId: string): Promise<GmailMessageDetail>;
  getAttachment(params: {
    messageId: string;
    attachmentId: string;
  }): Promise<Buffer>;
  listLabels(): Promise<Array<{ id: string; name: string; type?: string }>>;
  ensureLabel(name: string): Promise<{ id: string; name: string }>;
  modifyMessageLabels(params: {
    messageId: string;
    addLabelIds?: string[];
    removeLabelIds?: string[];
  }): Promise<void>;
  createDraft(params: {
    to: string;
    cc?: string[];
    subject: string;
    textBody: string;
    htmlBody?: string;
    attachments?: Array<{
      filename: string;
      mimeType: string;
      content: Buffer;
    }>;
  }): Promise<{ draftId: string; messageId: string | null }>;
}

export interface CalendarEventItem {
  id: string;
  summary: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  status?: string;
}

export interface CalendarPort {
  createSecondaryCalendar(params: {
    summary: string;
    description?: string;
    timeZone?: string;
  }): Promise<{ calendarId: string; summary: string }>;
  shareCalendar(params: {
    calendarId: string;
    email: string;
    role?: "reader" | "writer" | "owner";
  }): Promise<{ ruleId: string }>;
  listEvents(params: {
    calendarId: string;
    timeMin?: string;
    timeMax?: string;
  }): Promise<CalendarEventItem[]>;
  insertEvent(params: {
    calendarId: string;
    event: {
      summary: string;
      description?: string;
      start: { dateTime?: string; date?: string; timeZone?: string };
      end: { dateTime?: string; date?: string; timeZone?: string };
    };
  }): Promise<{ eventId: string }>;
  patchEvent(params: {
    calendarId: string;
    eventId: string;
    event: Partial<{
      summary: string;
      description: string;
      start: { dateTime?: string; date?: string; timeZone?: string };
      end: { dateTime?: string; date?: string; timeZone?: string };
    }>;
  }): Promise<{ eventId: string }>;
  deleteEvent(params: { calendarId: string; eventId: string }): Promise<void>;
}

export interface GoogleWorkspacePort {
  userEmail?: string;
  drive: DrivePort;
  sheets: SheetsPort;
  slides: SlidesPort;
  gmail: GmailPort;
  calendar: CalendarPort;
}

export interface InvoiceExtractionInput {
  pdfBuffer: Buffer;
  filename?: string;
  emailSubject?: string;
  projectContext: {
    codeProjet: string;
    client: string;
    nomJeu: string;
  };
  allProjectCodes?: string[];
  budgetLines: Array<{
    id: string;
    category: string;
    objet: string;
    realisePar?: string | null;
    preOpTotalHt: number;
  }>;
  quotes?: Array<{
    id: string;
    quoteNumber: string;
    vendorName: string;
    amountHt: number;
    budgetLineId?: string | null;
  }>;
}

export interface InvoiceExtractionOutput {
  prestataire: string;
  numeroFacture: string;
  dateFacture: string;
  montantHT: number;
  tvaRate: number;
  montantTTC: number;
  typeFacture: "ACOMPTE" | "SOLDE" | "UNIQUE";
  codeProjetDetecte: string | null;
  detectedProjectCodes?: string[];
  prestationSummary: string;
  suggestedBudgetLineId: string | null;
  suggestedBudgetLineLabel: string | null;
  suggestedQuoteId?: string | null;
  confidence: number;
  rawWarnings: string[];
  extractedRawTextSnippet: string;
}

export interface RetroVeilleInput {
  projectContext: {
    codeProjet: string;
    client: string;
    nomJeu: string;
  };
  emails: Array<{ id: string; subject: string; date: string; snippet: string }>;
  driveFiles: Array<{ id: string; name: string; modifiedTime?: string | null }>;
  currentTasks: Array<{
    id: string;
    phase: string;
    tache: string;
    status: string;
    startDate?: string | null;
    endDate?: string | null;
  }>;
}

export interface RetroVeilleProposalItem {
  retroTaskId: string | null;
  taskTitle: string;
  proposedStatus: "A_FAIRE" | "EN_COURS" | "EN_ATTENTE_CLIENT" | "TERMINE";
  proposedStartDate: string | null;
  proposedEndDate: string | null;
  deltaDays: number;
  sourceType: "GMAIL" | "DRIVE";
  sourceRef: string;
  summary: string;
  detectedCodeProjet: string | null;
  confidence: number;
}

export interface RetroVeilleOutput {
  proposals: RetroVeilleProposalItem[];
}

export interface InfluenceVisionInput {
  imageBuffer: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  talentName: string;
  platform: "TIKTOK" | "YOUTUBE_SHORTS" | "INSTAGRAM" | "SNAPCHAT";
}

export interface InfluenceVisionOutput {
  detectedPlatform: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  reposts: number | null;
  saves: number | null;
  engagementRate: number | null;
  detectedHandleOrCaption: string | null;
  fieldConfidence: Record<string, number>;
  extractionNotes: string[];
}

export interface GeminiPort {
  ping(): Promise<{ ok: true; model: string; latencyMs: number }>;
  extractInvoiceFromPdf(
    input: InvoiceExtractionInput
  ): Promise<InvoiceExtractionOutput>;
  analyzeRetroplanningVeille(
    input: RetroVeilleInput
  ): Promise<RetroVeilleOutput>;
  extractInfluenceMetricsFromImage(
    input: InfluenceVisionInput
  ): Promise<InfluenceVisionOutput>;
}
