/** 
 * In-memory cache to map button customIds to file URLs.
 * Bounded to a maximum size to prevent memory leaks, using a FIFO eviction policy when the cache size limit is reached.
 */
class BoundedCache<K, V> {
    private max_size: number;
    private map: Map<K, V>;

    /**
     * @param max_size Maximum size of the cache.
     */
    constructor(max_size = 1000) {
        this.max_size = max_size;
        this.map = new Map<K, V>();
    }

    /**
     * Set a key-value pair in the cache, evicting the oldest entry if size limit is exceeded.
     * @param key Entry key.
     * @param value Entry value.
     */
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

    /**
     * Get a value by key.
     * @param key Target key.
     * @returns Value if found, or undefined.
     */
    get(key: K): V | undefined {
        return this.map.get(key);
    }
}

/** BoundedCache instance for file opening mappings */
export const fileOpenCache = new BoundedCache<string, string>(1000);
