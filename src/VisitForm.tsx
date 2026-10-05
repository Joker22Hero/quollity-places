import { useSaveIntent } from './save-intent';
import type { Visit } from '../shared/contracts';
import { post, put, schemas } from './api';
import { MutationForm, nullableNumber, nullableText, text } from './components';
import { useReferenceData } from './state';
export function VisitForm({
  placeId,
  visit,
  onDone,
}: {
  placeId: string;
  visit?: Visit;
  onDone: () => void;
}) {
  const { people, trips, tripsError, refresh } = useReferenceData();
  const saveKey = useSaveIntent();
  return (
    <MutationForm
      label={visit ? 'Save visit' : 'Add visit'}
      onCancel={onDone}
      onSave={async (data) => {
        const input = {
          date: text(data, 'date'),
          endDate: nullableText(data, 'endDate'),
          overallRating: nullableNumber(data, 'rating'),
          notes: nullableText(data, 'notes'),
          wouldRevisit: nullableText(data, 'revisit'),
          tripId: nullableText(data, 'trip'),
          attendeeIds: data.getAll('attendees').map(String),
        };
        if (visit) await put(`/visits/${visit.id}`, input, schemas.savedVisit);
        else
          await post(
            `/places/${placeId}/visits`,
            input,
            schemas.savedVisit,
            saveKey(input),
          );
        refresh();
        onDone();
      }}
    >
      <div className="form-grid">
        <label>
          Date
          <input type="date" name="date" required defaultValue={visit?.date} />
        </label>
        <label>
          End date (optional)
          <input
            type="date"
            name="endDate"
            defaultValue={visit?.endDate ?? ''}
          />
        </label>
        <label>
          Overall rating
          <input
            type="number"
            name="rating"
            min={1}
            max={5}
            step={0.1}
            placeholder="Unrated"
            defaultValue={visit?.overallRating ?? ''}
          />
        </label>
        <label>
          Would revisit
          <select name="revisit" defaultValue={visit?.wouldRevisit ?? ''}>
            <option value="">Not recorded</option>
            <option value="definitely">Definitely</option>
            <option value="maybe">Maybe</option>
            <option value="probably_not">Probably not</option>
          </select>
        </label>
        <label className="span-2">
          Trip
          <select name="trip" defaultValue={visit?.tripId ?? ''}>
            <option value="">No trip link</option>
            {visit?.trip &&
              !trips.some((trip) => trip.tripId === visit.tripId) && (
                <option value={visit.tripId!}>{visit.trip.name}</option>
              )}
            {trips.map((trip) => (
              <option value={trip.tripId} key={trip.tripId}>
                {trip.name}
              </option>
            ))}
          </select>
        </label>
        {tripsError && (
          <p className="muted span-2">
            {tripsError} You can save a visit without a trip link.
          </p>
        )}
        <div className="span-2">
          <span className="field-label">Attendees</span>
          <div className="attendees">
            {people
              .filter(
                (person) =>
                  person.active ||
                  visit?.attendees.some(
                    (attendee) => attendee.id === person.id,
                  ),
              )
              .map((person) => (
                <label className="checkbox" key={person.id}>
                  <input
                    type="checkbox"
                    name="attendees"
                    value={person.id}
                    defaultChecked={visit?.attendees.some(
                      (attendee) => attendee.id === person.id,
                    )}
                  />
                  {person.displayName}
                  {!person.active && ' (inactive)'}
                </label>
              ))}
          </div>
        </div>
        <label className="span-2">
          Visit notes
          <textarea
            name="notes"
            rows={5}
            maxLength={20000}
            placeholder="What happened on this visit?"
            defaultValue={visit?.notes ?? ''}
          />
        </label>
      </div>
    </MutationForm>
  );
}
