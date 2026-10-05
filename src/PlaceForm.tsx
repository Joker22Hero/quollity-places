import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { placeFactsSchema } from '../shared/place-facts';
import type { Place } from '../shared/contracts';
import { ApiError, post, put, schemas } from './api';
import {
  MutationForm,
  nullableNumber,
  nullableText,
  text,
  countryName,
} from './components';
import { useReferenceData } from './state';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import {
  type Candidate,
  type Lookup,
  importedPlaceSchema,
} from '../shared/place-entry';
import { PlaceLookup, Attribution } from './PlaceLookup';
import { useSaveIntent } from './save-intent';
function PlaceEditor({
  place,
  onDone,
  selection,
  initialName = '',
}: {
  selection?: { lookup: Lookup; candidate: Candidate; experience?: boolean };
  initialName?: string;
  place?: Place;
  onDone?: () => void;
}) {
  const { types, refresh } = useReferenceData();
  const navigate = useNavigate();
  const candidate = selection?.candidate;
  const [kind, setKind] = useState(
    place?.placeKind ??
      (selection?.experience ? 'experience' : 'physical_place'),
  );
  const saveKey = useSaveIntent();
  const [review, setReview] = useState<{
    matches: Place[];
    duplicateReviewToken: string;
  } | null>(null);
  const [existing,setExisting]=useState<string|null>(null);
  const [approved, setApproved] = useState(false);
  return (
    <>
    {!place && <h3>Review place</h3>}
    {candidate?.enrichment.status==='unavailable' && <p role="status">Some external details are unavailable. You can still create this place.</p>}
    <MutationForm
      label={place ? 'Save place' : 'Create place'}
      onCancel={onDone}
      onSave={async (data) => {
        const input = {
          name: text(data, 'name'),
          shortName: nullableText(data, 'shortName'),
          placeTypeId: text(data, 'type'),
          placeKind: kind,
          wishlist: data.has('wishlist'),
          city: nullableText(data, 'city'),
          region: nullableText(data, 'region'),
          countryCode: nullableText(data, 'country'),
          latitude: nullableNumber(data, 'latitude'),
          longitude: nullableNumber(data, 'longitude'),
          websiteUrl: nullableText(data, 'website'),
          description: nullableText(data, 'description'),
          facts:placeFactsSchema.parse({
            ...(place?.facts ?? candidate?.facts),
            localName:nullableText(data,'localName'),
            alternateNames:text(data,'alternateNames').split(';').map(v=>v.trim()).filter(Boolean),
            streetAddress:nullableText(data,'streetAddress'),postcode:nullableText(data,'postcode'),phone:nullableText(data,'phone'),
            socialLinks:text(data,'socialLinks').split(/\n/).map(v=>v.trim()).filter(Boolean),
            operatingStatus:nullableText(data,'operatingStatus'),
          }),
          notes: nullableText(data, 'notes'),
          operator:
            kind === 'experience' ? nullableText(data, 'operator') : null,
          meetingPoint:
            kind === 'experience' ? nullableText(data, 'meetingPoint') : null,
          durationMinutes:
            kind === 'experience' ? nullableNumber(data, 'duration') : null,
        };
        let result: { place: Place };
        const duplicateReviewToken = approved
          ? review?.duplicateReviewToken
          : undefined;
        const payload = selection
          ? {
              lookupId: selection.lookup.lookupId,
              candidateId: selection.candidate.candidateId,
              placeTypeId: input.placeTypeId,
              placeKind: input.placeKind,
              wishlist: input.wishlist,
              notes: input.notes,
              shortName: input.shortName,
              description: input.description,
              operator: input.operator,
              meetingPoint: input.meetingPoint,
              durationMinutes: input.durationMinutes,
              duplicateAction: 'reject',
              duplicateReviewToken,
              overrides: {
                name: input.name,
                city: input.city,
                region: input.region,
                countryCode: input.countryCode,
                latitude: input.latitude,
                longitude: input.longitude,
                websiteUrl: input.websiteUrl,
                facts:input.facts,
              },
            }
          : { ...input, duplicateReviewToken };
        try {
          result = place
            ? await put(`/places/${place.id}`, input, schemas.savedPlace)
            : selection
              ? await post(
                  '/places/import',
                  payload,
                  importedPlaceSchema,
                  saveKey(payload),
                )
              : await post(
                  '/places',
                  payload,
                  schemas.savedPlace,
                  saveKey(payload),
                );
        } catch (error) {
          if(error instanceof ApiError && (error.code==='place_exists' || error.code==='place_archived')) {
            const details=z.object({placeId:z.uuid()}).safeParse(error.details);
            if(details.success) { setExisting(details.data.placeId); }
          }
          if (
            error instanceof ApiError &&
            error.code === 'possible_duplicate'
          ) {
            const details = z
              .object({
                matches: z.array(schemas.savedPlace.shape.place),
                duplicateReviewToken: z.string(),
              })
              .parse(error.details);
            setReview(details);
            setApproved(false);
          }
          throw error;
        }
        refresh();
        if (onDone) onDone();
        else navigate(`/place/${result.place.id}`);
      }}
    >
      {candidate && (
        <div className="selected-place">
          <p>
            {[
              candidate.city,
              candidate.region,
              countryName(candidate.countryCode),
            ]
              .filter(Boolean)
              .join(', ') || 'No location details available'}
          </p>
          <Attribution candidate={candidate} />
        </div>
      )}
      {existing && <p role="alert">This source is already saved. Your review edits have not been applied. <Link to={`/place/${existing}`}>Open the existing place</Link>.</p>}
      {review && (
        <div role="alert" className="duplicate-review">
          <p>Similar places are already saved:</p>
          <ul>
            {review.matches.map((p) => (
              <li key={p.id}>
                <Link to={`/place/${p.id}`}>
                  {p.name}
                  {p.archivedAt ? ' (archived)' : ''}
                </Link>
              </li>
            ))}
          </ul>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            This is a different place; create a separate record
          </label>
        </div>
      )}
      {candidate && <p className="muted">Review the factual details below. Visit dates, ratings and your photos can be added after creation.</p>}
      <div className="form-grid">
        <label className="span-2">
          Name
          <input
            name="name"
            required
            maxLength={200}
            defaultValue={place?.name ?? candidate?.name ?? initialName}
          />
        </label>
        <label>
          Type
          <select
            name="type"
            defaultValue={
              place?.placeTypeId ?? candidate?.suggestedTypeId ?? 'other'
            }
          >
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kind
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as typeof kind)}
          >
            <option value="physical_place">Physical place</option>
            <option value="experience">Experience</option>
          </select>
        </label>
        <label className="checkbox">
          <input
            name="wishlist"
            type="checkbox"
            defaultChecked={place?.wishlist}
          />
          On my wishlist
        </label>
        <label className="span-2">
          Place notes
          <textarea
            name="notes"
            rows={4}
            maxLength={20000}
            placeholder="What remains useful across visits?"
            defaultValue={place?.notes ?? ''}
          />
        </label>
        <details className="span-2" open={place ? true : undefined}>
          <summary>Edit details</summary>
          <div className="form-grid">
            <label>Local / original name<input name="localName" maxLength={200} defaultValue={place?.facts.localName ?? candidate?.facts.localName ?? ''} /></label>
            <label>Alternate names (separate with semicolons)<input name="alternateNames" defaultValue={(place?.facts.alternateNames ?? candidate?.facts.alternateNames ?? []).join('; ')} /></label>
            <label className="span-2">Street address<input name="streetAddress" maxLength={500} defaultValue={place?.facts.streetAddress ?? candidate?.facts.streetAddress ?? ''} /></label>
            <label>Postcode<input name="postcode" maxLength={40} defaultValue={place?.facts.postcode ?? candidate?.facts.postcode ?? ''} /></label>
            <label>Phone<input name="phone" maxLength={100} defaultValue={place?.facts.phone ?? candidate?.facts.phone ?? ''} /></label>
            <label>Operating status<select name="operatingStatus" defaultValue={place?.facts.operatingStatus ?? candidate?.facts.operatingStatus ?? ''}><option value="">Not recorded</option><option value="open">Open</option><option value="temporarily_closed">Temporarily closed</option><option value="permanently_closed">Permanently closed</option></select></label>
            <label className="span-2">Social links (one URL per line)<textarea name="socialLinks" rows={2} defaultValue={(place?.facts.socialLinks ?? candidate?.facts.socialLinks ?? []).join('\n')} /></label>
            <label>
              Short name
              <input
                name="shortName"
                maxLength={100}
                defaultValue={place?.shortName ?? ''}
              />
            </label>
            <label>
              City
              <input
                name="city"
                defaultValue={place?.city ?? candidate?.city ?? ''}
              />
            </label>
            <label>
              Region
              <input
                name="region"
                defaultValue={place?.region ?? candidate?.region ?? ''}
              />
            </label>
            <label>
              Country code
              <input
                name="country"
                placeholder="GB, JP, FR…"
                minLength={2}
                maxLength={2}
                defaultValue={
                  place?.countryCode ?? candidate?.countryCode ?? ''
                }
              />
            </label>
            <label>
              Website
              <input
                type="url"
                name="website"
                defaultValue={place?.websiteUrl ?? candidate?.websiteUrl ?? ''}
              />
            </label>
            <label>
              Latitude
              <input
                type="number"
                name="latitude"
                step="any"
                min={-90}
                max={90}
                defaultValue={place?.latitude ?? candidate?.latitude ?? ''}
              />
            </label>
            <label>
              Longitude
              <input
                type="number"
                name="longitude"
                step="any"
                min={-180}
                max={180}
                defaultValue={place?.longitude ?? candidate?.longitude ?? ''}
              />
            </label>
            {kind === 'experience' && (
              <>
                <label>
                  Operator
                  <input name="operator" defaultValue={place?.operator ?? ''} />
                </label>
                <label>
                  Duration (minutes)
                  <input
                    type="number"
                    min={1}
                    max={10080}
                    name="duration"
                    defaultValue={place?.durationMinutes ?? ''}
                  />
                </label>
                <label className="span-2">
                  Meeting point
                  <input
                    name="meetingPoint"
                    defaultValue={place?.meetingPoint ?? ''}
                  />
                </label>
              </>
            )}
            <label className="span-2">
              Description
              <textarea
                name="description"
                rows={3}
                maxLength={10000}
                defaultValue={place?.description ?? candidate?.description ?? ''}
              />
            </label>
          </div>
        </details>
      </div>
    </MutationForm>
    </>
  );
}

export function PlaceForm({
  place,
  onDone,
}: {
  place?: Place;
  onDone?: () => void;
}) {
  const [selection, setSelection] = useState<{
    lookup: Lookup;
    candidate: Candidate;
    experience?: boolean;
  } | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  if (place) return <PlaceEditor place={place} onDone={onDone} />;
  if (selection || manual !== null)
    return (
      <>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setSelection(null);
            setManual(null);
          }}
        >
          ← Search again
        </button>
        <PlaceEditor
          key={selection?.candidate.candidateId ?? 'manual'}
          selection={selection ?? undefined}
          initialName={manual ?? ''}
          onDone={onDone}
        />
      </>
    );
  return (
    <PlaceLookup
      onSelect={(lookup, candidate, experience) =>
        setSelection({ lookup, candidate, experience })
      }
      onManual={(query) => setManual(query.split(',')[0].trim())}
    />
  );
}
