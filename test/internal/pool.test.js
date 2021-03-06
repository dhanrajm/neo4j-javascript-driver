/**
 * Copyright (c) 2002-2017 "Neo Technology,","
 * Network Engine for Objects in Lund AB [http://neotechnology.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Pool from '../../src/v1/internal/pool';

describe('Pool', () => {

  it('allocates if pool is empty', (done) => {
    // Given
    let counter = 0;
    const key = 'bolt://localhost:7687';
    const pool = new Pool((url, release) => new Resource(url, counter++, release));

    // When
    const p0 = pool.acquire(key);
    const p1 = pool.acquire(key);

    // Then
    Promise.all([ p0, p1 ]).then(values => {
      const r0 = values[0];
      const r1 = values[1];

      expect(r0.id).toBe(0);
      expect(r1.id).toBe(1);
      expect(r0).not.toBe(r1);

      done();
    });
  });

  it('pools if resources are returned', (done) => {
    // Given a pool that allocates
    let counter = 0;
    const key = 'bolt://localhost:7687';
    const pool = new Pool((url, release) => new Resource(url, counter++, release));

    // When
    const p0 = pool.acquire(key).then(r0 => {
      r0.close();
      return r0;
    });
    const p1 = p0.then(r0 => pool.acquire(key));

    // Then
    Promise.all([ p0, p1 ]).then(values => {
      const r0 = values[0];
      const r1 = values[1];

      expect(r0.id).toBe(0);
      expect(r1.id).toBe(0);
      expect(r0).toBe(r1);

      done();
    });
  });

  it('handles multiple keys', (done) => {
    // Given a pool that allocates
    let counter = 0;
    const key1 = 'bolt://localhost:7687';
    const key2 = 'bolt://localhost:7688';
    const pool = new Pool((url, release) => new Resource(url, counter++, release));

    // When
    const p0 = pool.acquire(key1);
    const p1 = pool.acquire(key2);
    const p01 = Promise.all([ p0, p1 ]).then(values => values[0].close());
    const p2 = p01.then(() => pool.acquire(key1));
    const p3 = p01.then(() => pool.acquire(key2));

    // Then
    Promise.all([ p0, p1, p2, p3 ]).then(values => {
      const r0 = values[0];
      const r1 = values[1];
      const r2 = values[2];
      const r3 = values[3];

      expect(r0.id).toBe(0);
      expect(r1.id).toBe(1);
      expect(r2.id).toBe(0);
      expect(r3.id).toBe(2);

      expect(r0).toBe(r2);
      expect(r1).not.toBe(r3);

      done();
    });
  });

  it('frees if pool reaches max size', (done) => {
    // Given a pool that tracks destroyed resources
    let counter = 0;
    let destroyed = [];
    const key = 'bolt://localhost:7687';
    const pool = new Pool(
      (url, release) => new Resource(url, counter++, release),
      resource => {
        destroyed.push(resource);
      },
      resource => true,
      {
        maxIdleSize: 2
      }
    );

    // When
    const p0 = pool.acquire(key);
    const p1 = pool.acquire(key);
    const p2 = pool.acquire(key);

    // Then
    Promise.all([ p0, p1, p2 ]).then(values => {
      const r0 = values[0];
      const r1 = values[1];
      const r2 = values[2];

      r0.close();
      r1.close();
      r2.close();

      expect(destroyed.length).toBe(1);
      expect(destroyed[0].id).toBe(r2.id);

      done();
    });
  });

  it('frees if validate returns false', (done) => {
    // Given a pool that allocates
    let counter = 0;
    let destroyed = [];
    const key = 'bolt://localhost:7687';
    const pool = new Pool(
      (url, release) => new Resource(url, counter++, release),
      resource => {
        destroyed.push(resource);
      },
      resource => false,
      {
        maxIdleSize: 1000
      }
    );

    // When
    const p0 = pool.acquire(key);
    const p1 = pool.acquire(key);

    // Then
    Promise.all([ p0, p1 ]).then(values => {
      const r0 = values[0];
      const r1 = values[1];

      r0.close();
      r1.close();

      expect(destroyed.length).toBe(2);
      expect(destroyed[0].id).toBe(r0.id);
      expect(destroyed[1].id).toBe(r1.id);

      done();
    });
  });


  it('purges keys', (done) => {
    // Given a pool that allocates
    let counter = 0;
    const key1 = 'bolt://localhost:7687';
    const key2 = 'bolt://localhost:7688';
    const pool = new Pool((url, release) => new Resource(url, counter++, release),
      res => {
        res.destroyed = true;
        return true;
      }
    );

    // When
    const p0 = pool.acquire(key1);
    const p1 = pool.acquire(key2);
    const p01 = Promise.all([ p0, p1 ]).then(values => {
      values.forEach(v => v.close());

      expect(pool.has(key1)).toBeTruthy();
      expect(pool.has(key2)).toBeTruthy();

      pool.purge(key1);

      expect(pool.has(key1)).toBeFalsy();
      expect(pool.has(key2)).toBeTruthy();
    });

    const p2 = p01.then(() => pool.acquire(key1));
    const p3 = p01.then(() => pool.acquire(key2));

    // Then
    Promise.all([ p0, p1, p2, p3 ]).then(values => {
      const r0 = values[0];
      const r1 = values[1];
      const r2 = values[2];
      const r3 = values[3];

      expect(r0.id).toBe(0);
      expect(r0.destroyed).toBeTruthy();
      expect(r1.id).toBe(1);
      expect(r2.id).toBe(2);
      expect(r3.id).toBe(1);

      done();
    });
  });

  it('destroys resource when key was purged', (done) => {
    let counter = 0;
    const key = 'bolt://localhost:7687';
    const pool = new Pool((url, release) => new Resource(url, counter++, release),
      res => {
        res.destroyed = true;
        return true;
      }
    );

    const p0 = pool.acquire(key);
    p0.then(r0 => {
      expect(pool.has(key)).toBeTruthy();
      expect(r0.id).toEqual(0);

      pool.purge(key);
      expect(pool.has(key)).toBeFalsy();
      expect(r0.destroyed).toBeFalsy();

      r0.close();
      expect(pool.has(key)).toBeFalsy();
      expect(r0.destroyed).toBeTruthy();

      done();
    });
  });

  it('purges all keys', (done) => {
    let counter = 0;

    const key1 = 'bolt://localhost:7687';
    const key2 = 'bolt://localhost:7688';
    const key3 = 'bolt://localhost:7689';

    const pool = new Pool((url, release) => new Resource(url, counter++, release),
      res => {
        res.destroyed = true;
        return true;
      }
    );

    const acquiredResources = [
      pool.acquire(key1),
      pool.acquire(key2),
      pool.acquire(key3),
      pool.acquire(key1),
      pool.acquire(key2),
      pool.acquire(key3)
    ];

    Promise.all(acquiredResources).then(values => {
      values.forEach(resource => resource.close());

      pool.purgeAll();

      values.forEach(resource => expect(resource.destroyed).toBeTruthy());

      done();
    });
  });

  it('skips broken connections during acquire', (done) => {
    let validated = false;
    let counter = 0;
    const key = 'bolt://localhost:7687';
    const pool = new Pool((url, release) => new Resource(url, counter++, release),
      res => {
        res.destroyed = true;
        return true;
      },
      () => {
        if (validated) {
          return false;
        }
        validated = true;
        return true;
      }
    );

    const p0 = pool.acquire(key);
    const p1 = p0.then(r0 => {
      r0.close();

      return pool.acquire(key);
    });

    Promise.all([ p0, p1 ]).then(values => {
      const r0 = values[0];
      const r1 = values[1];

      expect(r1).not.toBe(r0);

      done();
    });
  });

  it('reports presence of the key', (done) => {
    const existingKey = 'bolt://localhost:7687';
    const absentKey = 'bolt://localhost:7688';

    const pool = new Pool((url, release) => new Resource(url, 42, release));

    const p0 = pool.acquire(existingKey);
    const p1 = pool.acquire(existingKey);

    Promise.all([ p0, p1 ]).then(() => {
      expect(pool.has(existingKey)).toBeTruthy();
      expect(pool.has(absentKey)).toBeFalsy();

      done();
    });
  });

  it('reports zero active resources when empty', () => {
    const pool = new Pool((url, release) => new Resource(url, 42, release));

    expect(pool.activeResourceCount('bolt://localhost:1')).toEqual(0);
    expect(pool.activeResourceCount('bolt://localhost:2')).toEqual(0);
    expect(pool.activeResourceCount('bolt://localhost:3')).toEqual(0);
  });

  it('reports active resources', (done) => {
    const key = 'bolt://localhost:7687';
    const pool = new Pool((url, release) => new Resource(url, 42, release));

    const p0 = pool.acquire(key);
    const p1 = pool.acquire(key);
    const p2 = pool.acquire(key);

    Promise.all([ p0, p1, p2 ]).then(values => {
      values.forEach(v => expect(v).toBeDefined());

      expect(pool.activeResourceCount(key)).toEqual(3);

      done();
    });
  });

  it('reports active resources when they are acquired', (done) => {
    const key = 'bolt://localhost:7687';
    const pool = new Pool((url, release) => new Resource(url, 42, release));

    // three new resources are created and returned to the pool
    const p0 = pool.acquire(key);
    const p1 = pool.acquire(key);
    const p2 = pool.acquire(key);
    const p012 = Promise.all([ p0, p1, p2 ]).then(values => {
      values.forEach(v => v.close());
      return values;
    });

    // three idle resources are acquired from the pool
    const p3 = p012.then(() => pool.acquire(key));
    const p4 = p012.then(() => pool.acquire(key));
    const p5 = p012.then(() => pool.acquire(key));

    const pAll = Promise.all([ p012, p3, p4, p5 ]).then(values => {
      const r0 = values[0][0];
      const r1 = values[0][1];
      const r2 = values[0][2];

      expect(values).toContain(r0);
      expect(values).toContain(r1);
      expect(values).toContain(r2);

      expect(pool.activeResourceCount(key)).toEqual(3);

      done();
    });
  });

  it('does not report resources that are returned to the pool', (done) => {
    const key = 'bolt://localhost:7687';
    const pool = new Pool((url, release) => new Resource(url, 42, release));

    const p0 = pool.acquire(key);
    const p1 = pool.acquire(key);
    const p2 = pool.acquire(key);
    const p012 = Promise.all([ p0, p1, p2 ]).then(values => {
      const r0 = values[0];
      const r1 = values[1];
      const r2 = values[2];

      expect(pool.activeResourceCount(key)).toEqual(3);

      r0.close();
      expect(pool.activeResourceCount(key)).toEqual(2);

      r1.close();
      expect(pool.activeResourceCount(key)).toEqual(1);

      r2.close();
      expect(pool.activeResourceCount(key)).toEqual(0);

      return values;
    });

    const p3 = p012.then(() => pool.acquire(key)).then(r3 => {
      expect(pool.activeResourceCount(key)).toEqual(1);

      r3.close();
      expect(pool.activeResourceCount(key)).toEqual(0);

      done();
    });
  });

  it('should wait for a returned connection when max pool size is reached', done => {
    let counter = 0;

    const key = 'bolt://localhost:7687';
    const pool = new Pool(
        (url, release) => new Resource(url, counter++, release),
        resource => {},
        resource => true,
        {
          maxSize: 2,
          acquisitionTimeout: 5000
        }
    );

    const p0 = pool.acquire(key);
    const p1 = pool.acquire(key);
    const p01 = Promise.all([ p0, p1 ]).then(values => {
      const r0 = values[0];
      const r1 = values[1];

      expect(r0.id).toEqual(0);
      expect(r1.id).toEqual(1);

      const p2 = pool.acquire(key).then(r2 => {
        expect(r2).toBe(r1);

        done();
      });

      setTimeout(() => r1.close(), 1000);
    });
  });

  it('should time out when max pool size is reached', done => {
    let counter = 0;

    const key = 'bolt://localhost:7687';
    const pool = new Pool(
        (url, release) => new Resource(url, counter++, release),
        resource => {},
        resource => true,
        {
          maxSize: 2,
          acquisitionTimeout: 1000
        }
    );

    const p0 = pool.acquire(key);
    const p1 = pool.acquire(key);
    const p01 = Promise.all([ p0, p1 ]).then(values => {
      const r0 = values[0];
      const r1 = values[1];

      expect(r0.id).toEqual(0);
      expect(r1.id).toEqual(1);

      pool.acquire(key).catch(error => {
        expect(error.message).toContain('timed out');

        done();
      });
    });
  });

  it('should not time out if max pool size is not set', done => {
    let counter = 0;

    const key = 'bolt://localhost:7687';
    const pool = new Pool(
        (url, release) => new Resource(url, counter++, release),
        resource => {},
        resource => true
    );

    const p0 = pool.acquire(key);
    const p1 = pool.acquire(key);
    const p01 = Promise.all([ p0, p1 ]).then(values => {
      const r0 = values[0];
      const r1 = values[1];

      expect(r0.id).toEqual(0);
      expect(r1.id).toEqual(1);

      pool.acquire(key).then(r2 => {
        expect(r2.id).toEqual(2);

        done();
      });
    });
  });

});

class Resource {

  constructor(key, id, release) {
    this.id = id;
    this.key = key;
    this.release = release;
    this.destroyed = false;
  }

  close() {
    this.release(this.key, this);
  }
}
