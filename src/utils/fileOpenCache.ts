/** 
 * In-memory cache to map button customIds to file URLs.
 * Bounded to a maximum size to prevent memory leaks, and entries are removed once consumed.
 */
class BoundedCache<K, V> {
    private max_size: number;
    private map: Map<K, V>;

    constructor(max_size = 1000) {
        this.max_size = max_size;
        this.map = new Map<K, V>();
    }

    set(key: K, value: V) {
        if (this.map.size >= this.max_size) {
            // Remove the oldest entry (first item in the map's insertion order)
            const firstKey = this.map.keys().next().value;
            if (firstKey !== undefined) {
                this.map.delete(firstKey);
            }
        }
        this.map.set(key, value);
    }

    get(key: K): V | undefined {
        return this.map.get(key);
    }
}

export const fileOpenCache = new BoundedCache<string, string>(1000);
