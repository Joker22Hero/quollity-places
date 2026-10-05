import { useState } from 'react';
import type { Place } from '../shared/contracts';
import {
  previewResponseSchema,
  type Candidate,
  type Lookup,
  type LocationField,
} from '../shared/place-entry';
import { post, request, schemas } from './api';
import { MutationForm } from './components';
import { PlaceLookup, Attribution } from './PlaceLookup';
import { useReferenceData } from './state';
import type { z } from 'zod';
export function LocationRepair({
  place,
  onDone,
}: {
  place: Place;
  onDone: () => void;
}) {
  const { refresh } = useReferenceData();
  const [selection, setSelection] = useState<{
      lookup: Lookup;
      candidate: Candidate;
    } | null>(null),
    [preview, setPreview] = useState<z.infer<
      typeof previewResponseSchema
    > | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<LocationField[]>([]);
  return (
    <section>
      <h3>Find location</h3>
      {!preview ? (
        <>
          <fieldset disabled={busy}>
            <PlaceLookup
              initialQuery={[place.name, place.city, place.countryCode]
                .filter(Boolean)
                .join(', ')}
              onSelect={(lookup, candidate) => {
                setBusy(true);
                setError('');
                void post(
                  `/places/${place.id}/location-preview`,
                  {
                    lookupId: lookup.lookupId,
                    candidateId: candidate.candidateId,
                  },
                  previewResponseSchema,
                )
                  .then((data) => {
                    setSelection({ lookup, candidate });
                    setPreview(data);
                    setFields(
                      data.changes
                        .filter((change) => !change.protected)
                        .map((change) => change.field),
                    );
                  })
                  .catch((error) =>
                    setError(
                      error instanceof Error
                        ? error.message
                        : 'Preview failed.',
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            />
          </fieldset>
          {busy && <p role="status">Preparing changes…</p>}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button type="button" className="secondary" onClick={onDone}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <h4>{preview.candidate.name}</h4>
          <Attribution candidate={preview.candidate} />
          {preview.changes.length ? (
            <MutationForm
              label="Apply selected location details"
              onCancel={onDone}
              onSave={async () => {
                if (!selection || !fields.length)
                  throw new Error('Select at least one field to apply.');
                await request(
                  `/places/${place.id}/location`,
                  schemas.savedPlace,
                  {
                    method: 'PATCH',
                    body: JSON.stringify({
                      lookupId: selection.lookup.lookupId,
                      candidateId: selection.candidate.candidateId,
                      revision: preview.revision,
                      fields,
                    }),
                  },
                );
                refresh();
                onDone();
              }}
            >
              <p>
                Select changes to apply. Your manual values remain unless you
                select them.
              </p>
              <ul className="lookup-results">
                {preview.changes.map((change) => (
                  <li key={change.field}>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={fields.includes(change.field)}
                        onChange={(e) => {
                          const pair =
                            change.field === 'latitude' ||
                            change.field === 'longitude'
                              ? (['latitude', 'longitude'] as LocationField[])
                              : [change.field];
                          setFields((current) =>
                            e.target.checked
                              ? [...new Set([...current, ...pair])]
                              : current.filter((f) => !pair.includes(f)),
                          );
                        }}
                      />
                      <span>
                        {change.field}:{' '}
                        {String(change.current ?? 'Not recorded')} →{' '}
                        {String(change.proposed ?? 'Not recorded')}
                        {change.protected ? ' · Your existing value' : ''}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </MutationForm>
          ) : (
            <p>No new location details to apply.</p>
          )}
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setPreview(null);
              setSelection(null);
            }}
          >
            Choose another result
          </button>
        </>
      )}
    </section>
  );
}
