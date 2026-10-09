import { Readable } from 'stream';

import { SupabaseConfig } from '../supabase.config';
import {
  SupabaseAttachmentRepository,
  SupabaseStorageError,
} from './attachment.repository';

const config = {
  table: 'files',
  url: 'https://ref.supabase.co',
  serviceKey: 'service-key',
  bucket: 'files',
} as SupabaseConfig;

function respond(
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Response(
    body === undefined
      ? null
      : typeof body === 'string'
        ? body
        : JSON.stringify(body),
    { status, headers },
  );
}

describe('shared-supabase: SupabaseAttachmentRepository', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('should upload an immutable object with its file name as metadata', async () => {
    // Arrange
    fetchMock.mockResolvedValue(respond(200, { Key: 'files/a1' }));
    const repository = new SupabaseAttachmentRepository(config);

    // Act
    await repository.upload({
      id: 'a1',
      fileName: 'umowa.pdf',
      stream: Readable.from([Buffer.from('%PDF')]),
      mimeType: 'application/pdf',
      encoding: '7bit',
    });

    // Assert
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ref.supabase.co/storage/v1/object/files/a1');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer service-key',
      'Content-Type': 'application/pdf',
      'x-upsert': 'false',
    });
    expect(
      JSON.parse(Buffer.from(init.headers['x-metadata'], 'base64').toString()),
    ).toEqual({ fileName: 'umowa.pdf', encoding: '7bit' });
    expect(Buffer.from(init.body).toString()).toBe('%PDF');
  });

  it('should return file info, or null for a missing object', async () => {
    // Arrange
    fetchMock
      .mockResolvedValueOnce(
        respond(200, {
          metadata: { mimetype: 'image/jpeg', size: 42 },
          user_metadata: { fileName: 'a.jpg' },
        }),
      )
      .mockResolvedValueOnce(respond(404, { error: 'not found' }));
    const repository = new SupabaseAttachmentRepository(config);

    // Act
    const found = await repository.getInfo('a1');
    const missing = await repository.getInfo('a2');

    // Assert
    expect(found).toEqual({
      fileName: 'a.jpg',
      contentType: 'image/jpeg',
      length: 42,
    });
    expect(missing).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://ref.supabase.co/storage/v1/object/info/authenticated/files/a1',
    );
  });

  it('should stream a byte range', async () => {
    // Arrange
    fetchMock.mockResolvedValue(respond(206, 'cde'));
    const repository = new SupabaseAttachmentRepository(config);

    // Act
    const stream = await repository.getStream('a1', { start: 2, end: 4 });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));

    // Assert
    expect(fetchMock.mock.calls[0][1].headers.Range).toBe('bytes=2-4');
    expect(Buffer.concat(chunks).toString()).toBe('cde');
  });

  it('should delete, treating a missing object as already deleted', async () => {
    // Arrange
    fetchMock
      .mockResolvedValueOnce(respond(200, {}))
      .mockResolvedValueOnce(respond(404, {}));
    const repository = new SupabaseAttachmentRepository(config);

    // Act
    await repository.delete('a1');
    await repository.delete('a2');

    // Assert
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://ref.supabase.co/storage/v1/object/files/a1',
    );
  });

  it.each(['../secret', 'a/b', '', '.hidden'])(
    'should refuse the attachment id %j before any request',
    async (id) => {
      // Arrange
      const repository = new SupabaseAttachmentRepository(config);

      // Act & Assert
      await expect(repository.getInfo(id)).rejects.toBeInstanceOf(
        SupabaseStorageError,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('should report a failed request without the key or the response body', async () => {
    // Arrange
    fetchMock.mockResolvedValue(
      respond(500, 'internal detail with service-key'),
    );
    const repository = new SupabaseAttachmentRepository(config);

    // Act
    const error = await repository.delete('a1').catch((e) => e);

    // Assert
    expect(error).toBeInstanceOf(SupabaseStorageError);
    expect(error.status).toBe(503);
    expect(String(error.message)).not.toContain('service-key');
  });
});
