export type PreconditionCode =
  | "GOOGLE_NOT_CONNECTED"
  | "GOOGLE_OAUTH_CONFIG_MISSING"
  | "GOOGLE_TOKEN_EXPIRED"
  | "GEMINI_KEY_MISSING";

export class PreconditionError extends Error {
  readonly httpStatus = 412 as const;
  readonly statusCode = 412 as const;
  readonly code: PreconditionCode;
  readonly setupUrl = "/settings" as const;

  constructor(code: PreconditionCode, message: string) {
    super(message);
    this.name = "PreconditionError";
    this.code = code;
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      setupUrl: this.setupUrl,
    };
  }
}

export class OAuthStateError extends Error {
  readonly httpStatus = 400 as const;
  readonly statusCode = 400 as const;
  readonly code = "OAUTH_STATE_MISMATCH" as const;

  constructor(message = "État OAuth2 CSRF invalide ou expiré.") {
    super(message);
    this.name = "OAuthStateError";
  }
}

export class AppHttpError extends Error {
  readonly httpStatus: number;
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    httpStatus: number,
    code: string,
    message: string,
    details?: unknown
  ) {
    super(message);
    this.name = "AppHttpError";
    this.httpStatus = httpStatus;
    this.statusCode = httpStatus;
    this.code = code;
    this.details = details;
  }
}
