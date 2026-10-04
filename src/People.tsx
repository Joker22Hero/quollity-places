import { useState } from 'react';
import type { Person } from '../shared/contracts';
import { post, put, schemas } from './api';
import { Action, MutationForm, text } from './components';
import { useReferenceData } from './state';
export function People() {
  const { people, session, refresh } = useReferenceData();
  const [edit, setEdit] = useState<Person | null>(null);
  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Shared memories</p>
          <h1>People</h1>
          <p className="intro">
            Choose who attended each visit. Inactive people remain in past
            visits.
          </p>
        </div>
      </header>
      {!session.readOnly && (
        <section>
          <h2>{edit ? `Edit ${edit.displayName}` : 'Add someone'}</h2>
          <MutationForm
            key={edit?.id ?? 'new'}
            label={edit ? 'Save person' : 'Add person'}
            onCancel={edit ? () => setEdit(null) : undefined}
            onSave={async (data) => {
              const input = {
                displayName: text(data, 'name'),
                active: edit?.active ?? true,
              };
              if (edit)
                await put(`/people/${edit.id}`, input, schemas.savedPerson);
              else await post('/people', input, schemas.savedPerson);
              refresh();
              setEdit(null);
            }}
          >
            <label>
              Name
              <input
                key={people.length}
                name="name"
                required
                maxLength={100}
                defaultValue={edit?.displayName}
              />
            </label>
          </MutationForm>
        </section>
      )}
      <ul className="people-list">
        {people.map((person) => (
          <li key={person.id}>
            <div>
              <strong>{person.displayName}</strong>
              <span className="muted">
                {person.active ? 'Active' : 'Inactive'}
              </span>
            </div>
            {!session.readOnly && (
              <div className="actions">
                <button className="secondary" onClick={() => setEdit(person)}>
                  Edit
                </button>
                {person.id !== session.person?.id && (
                  <Action
                    run={async () => {
                      await put(
                        `/people/${person.id}`,
                        {
                          displayName: person.displayName,
                          active: !person.active,
                        },
                        schemas.savedPerson,
                      );
                      refresh();
                    }}
                  >
                    {person.active ? 'Deactivate' : 'Activate'}
                  </Action>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
