import { AwrmError, digest, type PassRecord } from '@awrm/core';

/**
 * Explicit owner authorisation for one export of one Pass to one destination.
 * Exporters refuse to run without it, and it cannot be reused for a different
 * Pass or destination.
 */
export interface ExportAuthorization {
  approvedBy: 'owner';
  passDigest: string;
  destination: string; // `${baseUrl}/r/${resourceId}`
  protocol: 'PURL/0.1' | 'ACSP/0.1';
  approvedAt: string;
}

export function checkExportAuthorization(auth: ExportAuthorization | null, pass: PassRecord, destination: string, protocol: ExportAuthorization['protocol']): void {
  if (!auth) throw new AwrmError('forbidden', 'export requires explicit owner authorisation');
  if (auth.approvedBy !== 'owner') throw new AwrmError('forbidden', 'only the owner can authorise export');
  if (auth.passDigest !== pass.digest) throw new AwrmError('forbidden', 'authorisation is for a different Pass');
  if (auth.destination !== destination) throw new AwrmError('forbidden', 'authorisation is for a different destination');
  if (auth.protocol !== protocol) throw new AwrmError('forbidden', 'authorisation is for a different protocol');
  const { digest: d, ...body } = pass;
  if (digest(body) !== d) throw new AwrmError('integrity', 'Pass digest mismatch; refusing to export');
}

export class InteropError extends AwrmError {
  constructor(public readonly protocol: string, public readonly status: number, public readonly problem: unknown, message: string) {
    super('interop', message, { protocol, status, problem });
  }
}
