import { google, type gmail_v1 } from "googleapis";
import type { GmailMessageDetail, GmailPort } from "@/lib/ports";

function decodeBase64Url(data: string | null | undefined): Buffer {
  if (!data) return Buffer.alloc(0);
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

function encodeBase64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function encodeRfc2047Subject(subject: string): string {
  const b64 = Buffer.from(subject, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

function extractParts(
  payload: gmail_v1.Schema$MessagePart | undefined,
  acc: {
    textBody: string[];
    htmlBody: string[];
    attachments: GmailMessageDetail["attachments"];
  }
): void {
  if (!payload) return;

  const filename = payload.filename ?? "";
  const attachmentId = payload.body?.attachmentId ?? "";
  if (filename && attachmentId) {
    acc.attachments.push({
      attachmentId,
      filename,
      mimeType: payload.mimeType ?? "application/octet-stream",
      size: payload.body?.size ?? 0,
    });
  } else if (payload.mimeType === "text/plain" && payload.body?.data) {
    acc.textBody.push(decodeBase64Url(payload.body.data).toString("utf8"));
  } else if (payload.mimeType === "text/html" && payload.body?.data) {
    acc.htmlBody.push(decodeBase64Url(payload.body.data).toString("utf8"));
  }

  for (const child of payload.parts ?? []) {
    extractParts(child, acc);
  }
}

export class GmailAdapter implements GmailPort {
  private readonly api: gmail_v1.Gmail;

  // Note: Draft-First invariant — GmailAdapter intentionally does NOT implement sendMessage or call users.messages.send.
  constructor(params: {
    auth: InstanceType<typeof google.auth.OAuth2>;
    rootUrl?: string;
  }) {
    this.api = google.gmail({
      version: "v1",
      auth: params.auth,
      ...(params.rootUrl ? { rootUrl: params.rootUrl } : {}),
    });
  }

  async listMessages(params: {
    q?: string;
    maxResults?: number;
    pageToken?: string;
    labelIds?: string[];
  }): Promise<{
    messages: Array<{ id: string; threadId?: string | null }>;
    nextPageToken?: string | null;
  }> {
    const res = await this.api.users.messages.list({
      userId: "me",
      q: params.q,
      maxResults: params.maxResults ?? 25,
      pageToken: params.pageToken,
      labelIds: params.labelIds,
    });
    return {
      messages: (res.data.messages ?? []).map((m) => ({
        id: m.id ?? "",
        threadId: m.threadId ?? null,
      })),
      nextPageToken: res.data.nextPageToken ?? null,
    };
  }

  async getMessage(messageId: string): Promise<GmailMessageDetail> {
    const res = await this.api.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });
    const msg = res.data;
    const headers = msg.payload?.headers ?? [];
    const headerValue = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value ?? "";

    const acc = {
      textBody: [] as string[],
      htmlBody: [] as string[],
      attachments: [] as GmailMessageDetail["attachments"],
    };
    extractParts(msg.payload, acc);

    return {
      id: msg.id ?? messageId,
      threadId: msg.threadId ?? null,
      subject: headerValue("Subject"),
      from: headerValue("From"),
      to: headerValue("To"),
      date: headerValue("Date"),
      snippet: msg.snippet ?? "",
      textBody: acc.textBody.join("\n"),
      htmlBody: acc.htmlBody.join("\n"),
      labelIds: msg.labelIds ?? [],
      attachments: acc.attachments,
    };
  }

  async getAttachment(params: {
    messageId: string;
    attachmentId: string;
  }): Promise<Buffer> {
    const res = await this.api.users.messages.attachments.get({
      userId: "me",
      messageId: params.messageId,
      id: params.attachmentId,
    });
    return decodeBase64Url(res.data.data);
  }

  async listLabels(): Promise<
    Array<{ id: string; name: string; type?: string }>
  > {
    const res = await this.api.users.labels.list({ userId: "me" });
    return (res.data.labels ?? []).map((l) => ({
      id: l.id ?? "",
      name: l.name ?? "",
      type: l.type ?? undefined,
    }));
  }

  async ensureLabel(name: string): Promise<{ id: string; name: string }> {
    const existing = await this.listLabels();
    const found = existing.find(
      (l) => l.name.toLowerCase() === name.toLowerCase()
    );
    if (found) {
      return { id: found.id, name: found.name };
    }
    const res = await this.api.users.labels.create({
      userId: "me",
      requestBody: {
        name,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      },
    });
    return {
      id: res.data.id ?? "",
      name: res.data.name ?? name,
    };
  }

  async modifyMessageLabels(params: {
    messageId: string;
    addLabelIds?: string[];
    removeLabelIds?: string[];
  }): Promise<void> {
    await this.api.users.messages.modify({
      userId: "me",
      id: params.messageId,
      requestBody: {
        addLabelIds: params.addLabelIds,
        removeLabelIds: params.removeLabelIds,
      },
    });
  }

  async createDraft(params: {
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
  }): Promise<{ draftId: string; messageId: string | null }> {
    const stripCrlf = (val: string) => val.replace(/[\r\n]+/g, " ").trim();
    const safeTo = stripCrlf(params.to);
    const safeCc = (params.cc ?? [])
      .map((entry) => stripCrlf(entry))
      .filter(Boolean);

    const headers: string[] = [
      `To: ${safeTo}`,
      ...(safeCc.length > 0 ? [`Cc: ${safeCc.join(", ")}`] : []),
      `Subject: ${encodeRfc2047Subject(stripCrlf(params.subject))}`,
      "MIME-Version: 1.0",
    ];

    const hasAttachments =
      Boolean(params.attachments) && (params.attachments?.length ?? 0) > 0;
    let bodySection: string;

    if (!hasAttachments && !params.htmlBody) {
      headers.push('Content-Type: text/plain; charset="UTF-8"');
      headers.push("Content-Transfer-Encoding: base64");
      bodySection = Buffer.from(params.textBody, "utf8").toString("base64");
    } else if (!hasAttachments && params.htmlBody) {
      const altBoundary = `go_alt_${Date.now().toString(16)}`;
      headers.push(
        `Content-Type: multipart/alternative; boundary="${altBoundary}"`
      );
      bodySection = [
        `--${altBoundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(params.textBody, "utf8").toString("base64"),
        `--${altBoundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(params.htmlBody, "utf8").toString("base64"),
        `--${altBoundary}--`,
      ].join("\r\n");
    } else {
      const mixedBoundary = `go_mix_${Date.now().toString(16)}`;
      headers.push(
        `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`
      );

      const parts: string[] = [];
      if (params.htmlBody) {
        const altBoundary = `go_alt_${Date.now().toString(16)}`;
        parts.push(
          `--${mixedBoundary}`,
          `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
          "",
          `--${altBoundary}`,
          'Content-Type: text/plain; charset="UTF-8"',
          "Content-Transfer-Encoding: base64",
          "",
          Buffer.from(params.textBody, "utf8").toString("base64"),
          `--${altBoundary}`,
          'Content-Type: text/html; charset="UTF-8"',
          "Content-Transfer-Encoding: base64",
          "",
          Buffer.from(params.htmlBody, "utf8").toString("base64"),
          `--${altBoundary}--`
        );
      } else {
        parts.push(
          `--${mixedBoundary}`,
          'Content-Type: text/plain; charset="UTF-8"',
          "Content-Transfer-Encoding: base64",
          "",
          Buffer.from(params.textBody, "utf8").toString("base64")
        );
      }

      for (const att of params.attachments ?? []) {
        const safeFilename = att.filename.replace(/[\r\n"\\]+/g, "").trim() || "document.pdf";
        const safeMimeType = att.mimeType.replace(/[\r\n;]+/g, "").trim() || "application/pdf";
        parts.push(
          `--${mixedBoundary}`,
          `Content-Type: ${safeMimeType}; name="${safeFilename}"`,
          "Content-Transfer-Encoding: base64",
          `Content-Disposition: attachment; filename="${safeFilename}"`,
          "",
          att.content.toString("base64")
        );
      }
      parts.push(`--${mixedBoundary}--`);
      bodySection = parts.join("\r\n");
    }

    const rawMime = `${headers.join("\r\n")}\r\n\r\n${bodySection}`;
    const raw = encodeBase64Url(Buffer.from(rawMime, "utf8"));

    const res = await this.api.users.drafts.create({
      userId: "me",
      requestBody: {
        message: { raw },
      },
    });

    return {
      draftId: res.data.id ?? "",
      messageId: res.data.message?.id ?? null,
    };
  }
}
