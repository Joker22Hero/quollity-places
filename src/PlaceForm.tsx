import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Place } from '../shared/contracts';
import { post, put, schemas } from './api';
import { MutationForm, nullableNumber, nullableText, text } from './components';
import { useReferenceData } from './state';
export function PlaceForm({
  place,
  onDone,
}: {
  place?: Place;
  onDone?: () => void;
}) {
  const { types, refresh } = useReferenceData();
  const navigate = useNavigate();
  const [kind, setKind] = useState(place?.placeKind ?? 'physical_place');
  return (
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
          notes: nullableText(data, 'notes'),
          operator:
            kind === 'experience' ? nullableText(data, 'operator') : null,
          meetingPoint:
            kind === 'experience' ? nullableText(data, 'meetingPoint') : null,
          durationMinutes:
            kind === 'experience' ? nullableNumber(data, 'duration') : null,
        };
        const result = place
          ? await put(`/places/${place.id}`, input, schemas.savedPlace)
          : await post('/places', input, schemas.savedPlace);
        refresh();
        if (onDone) onDone();
        else navigate(`/place/${result.place.id}`);
      }}
    >
      <div className="form-grid">
        <label className="span-2">
          Name
          <input
            name="name"
            required
            maxLength={200}
            defaultValue={place?.name}
          />
        </label>
        <label>
          Short name
          <input
            name="shortName"
            maxLength={100}
            defaultValue={place?.shortName ?? ''}
          />
        </label>
        <label>
          Type
          <select name="type" defaultValue={place?.placeTypeId ?? 'museum'}>
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
        <label>
          City
          <input name="city" defaultValue={place?.city ?? ''} />
        </label>
        <label>
          Region
          <input name="region" defaultValue={place?.region ?? ''} />
        </label>
        <label>
          Country code
          <input
            name="country"
            placeholder="GB, JP, FR…"
            minLength={2}
            maxLength={2}
            defaultValue={place?.countryCode ?? ''}
          />
        </label>
        <label>
          Website
          <input
            type="url"
            name="website"
            defaultValue={place?.websiteUrl ?? ''}
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
            defaultValue={place?.latitude ?? ''}
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
            defaultValue={place?.longitude ?? ''}
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
            defaultValue={place?.description ?? ''}
          />
        </label>
        <label className="span-2">
          Place notes
          <textarea
            name="notes"
            rows={5}
            maxLength={20000}
            placeholder="What remains useful across visits?"
            defaultValue={place?.notes ?? ''}
          />
        </label>
      </div>
    </MutationForm>
  );
}
