import { Injectable } from '@nestjs/common';

import { IAttachmentRepository, IEntity } from '@smartsoft001/domain-core';

import { Readable } from 'stream';

import { SupabaseConfig } from '../supabase.config';

const OBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;
const FOLDER = /^[A-Za-z0-9_-]{1,100}$/;
const TIMEOUT = 30000;

/** A Storage request failed; the message never carries keys, URLs with tokens or response bodies. */
export class SupabaseStorageError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * `IAttachmentRepository` on Supabase Storage: one object per attachment id in
 * the configured `bucket`, written with the server-side `serviceKey`. The file
 * name travels as object metadata. Objects are never overwritten
 * (`x-upsert: false`), so an id names one immutable file.
 */
@Injectable()
export class SupabaseAttachmentRepository<
  T extends IEntity<string>,
> extends IAttachmentRepository<T> {
  constructor(protected readonly config: SupabaseConfig) {
    super();
  }

  async upload(
    data: {
      id: string;
      fileName: string;
      stream: any;
      mimeType: string;
      encoding: string;
    },
    options?: { streamCallback?: (r: any) => void },
  ): Promise<void> {
    const body = await this.buffer(data.stream);
    options?.streamCallback?.(body);
    const response = await this.request(
      'POST',
      `/object/${this.path(data.id)}`,
      {
        body: Uint8Array.from(body),
        headers: {
          'Content-Type': data.mimeType || 'application/octet-stream',
          'x-upsert': 'false',
          'x-metadata': Buffer.from(
            JSON.stringify({
              fileName: data.fileName,
              encoding: data.encoding,
            }),
          ).toString('base64'),
        },
      },
    );
    await this.expect(response, 'upload');
  }

  async getInfo(
    id: string,
  ): Promise<{ fileName: string; contentType: string; length: number } | null> {
    const response = await this.request(
      'GET',
      `/object/info/authenticated/${this.path(id)}`,
    );
    if (response.status === 404 || response.status === 400) {
      await response.body?.cancel();
      return null;
    }
    await this.expect(response, 'info', false);
    const info = (await response.json()) as {
      name?: string;
      metadata?: { mimetype?: string; size?: number; contentLength?: number };
      user_metadata?: { fileName?: string };
      content_type?: string;
      size?: number;
    };
    return {
      fileName: info.user_metadata?.fileName ?? id,
      contentType:
        info.metadata?.mimetype ??
        info.content_type ??
        'application/octet-stream',
      length: Number(
        info.metadata?.size ?? info.metadata?.contentLength ?? info.size ?? 0,
      ),
    };
  }

  async getStream(
    id: string,
    options?: { start: number; end?: number },
  ): Promise<any> {
    const headers: Record<string, string> = {};
    if (options) {
      if (
        !Number.isSafeInteger(options.start) ||
        options.start < 0 ||
        (options.end !== undefined &&
          (!Number.isSafeInteger(options.end) || options.end < options.start))
      )
        throw new SupabaseStorageError(400, 'Invalid byte range');
      headers['Range'] = `bytes=${options.start}-${options.end ?? ''}`;
    }
    const response = await this.request(
      'GET',
      `/object/authenticated/${this.path(id)}`,
      { headers },
    );
    await this.expect(response, 'download', false);
    if (!response.body)
      throw new SupabaseStorageError(502, 'Storage returned no content');
    return Readable.fromWeb(response.body as any);
  }

  async delete(id: string): Promise<void> {
    const response = await this.request('DELETE', `/object/${this.path(id)}`);
    if (response.status === 404) {
      await response.body?.cancel();
      return;
    }
    await this.expect(response, 'delete');
  }

  protected path(id: string): string {
    if (typeof id !== 'string' || !OBJECT_ID.test(id) || id.includes('..'))
      throw new SupabaseStorageError(400, 'Invalid attachment id');
    if (!this.config.bucket || !OBJECT_ID.test(this.config.bucket))
      throw new SupabaseStorageError(500, 'SupabaseConfig.bucket is required');
    const folder = this.config.folder;
    if (folder !== undefined && !FOLDER.test(folder))
      throw new SupabaseStorageError(500, 'Invalid SupabaseConfig.folder');
    return folder === undefined
      ? `${this.config.bucket}/${id}`
      : `${this.config.bucket}/${folder}/${id}`;
  }

  protected get baseUrl(): string {
    const base =
      this.config.storageUrl ??
      (this.config.url
        ? `${this.config.url.replace(/\/$/, '')}/storage/v1`
        : '');
    if (!base)
      throw new SupabaseStorageError(
        500,
        'SupabaseConfig.url or storageUrl is required',
      );
    return base.replace(/\/$/, '');
  }

  protected async request(
    method: string,
    path: string,
    init: { body?: BodyInit; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    if (!this.config.serviceKey)
      throw new SupabaseStorageError(
        500,
        'SupabaseConfig.serviceKey is required',
      );
    try {
      return await fetch(this.baseUrl + path, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT),
        headers: {
          Authorization: 'Bearer ' + this.config.serviceKey,
          ...(this.config.anonKey ? { apikey: this.config.anonKey } : {}),
          ...init.headers,
        },
        ...(init.body ? { body: init.body } : {}),
      });
    } catch {
      throw new SupabaseStorageError(503, 'Storage unavailable');
    }
  }

  protected async expect(
    response: Response,
    operation: string,
    consume = true,
  ): Promise<void> {
    if (response.ok) {
      if (consume) await response.body?.cancel();
      return;
    }
    await response.body?.cancel();
    throw new SupabaseStorageError(
      response.status >= 500 ? 503 : response.status,
      `Storage ${operation} failed with status ${response.status}`,
    );
  }

  protected async buffer(stream: unknown): Promise<Buffer> {
    if (Buffer.isBuffer(stream)) return stream;
    if (stream instanceof Uint8Array) return Buffer.from(stream);
    if (
      !stream ||
      typeof (stream as AsyncIterable<unknown>)[Symbol.asyncIterator] !==
        'function'
    )
      throw new SupabaseStorageError(400, 'Attachment stream is required');
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer | string>)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
}
