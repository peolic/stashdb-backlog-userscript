type AnyObject =
    | "scenes"
    | "performers"
    | "studios"
    | "tags"
    | "categories"
    | "edits"
    | "users"
    | "search"

interface LocationData {
    object: AnyObject | null;
    ident: string | null;
    action: string | null;
}

interface FetchError {
    error: boolean;
    status: number;
    body: string | null;
}

type SceneFingerprint = {
    algorithm: string;
    hash: string;
    correct_scene_id: string | null;
}

interface SceneDataObject {
    duplicates?: string[];
    duplicate_of?: string;
    title?: string;
    date?: string;
    duration?: string;
    performers?: {
        remove: PerformerEntry[];
        append: PerformerEntry[];
        update?: PerformerEntry[];
    };
    studio?: [id: string, name: string];
    url?: string;
    details?: string;
    director?: string;
    // tags?: string[];
    image?: string;
    fingerprints?: SceneFingerprint[];
    comments?: string[];
}

interface PerformerDataObject {
    duplicates?: {
        ids: string[];
        notes?: string[];
    };
    duplicate_of?: string;
    split?: {}
}

interface BaseCache {
    lastUpdated?: string;
    lastChecked?: string;
}

interface DataCache extends BaseCache {
    scenes: { [uuid: string]: SceneDataObject };
    performers: { [uuid: string]: PerformerDataObject };
}

type SupportedObject = Exclude<keyof DataCache, keyof BaseCache>

type DataObject = DataCache[SupportedObject][string]
type DataObjectKeys = keyof (SceneDataObject & PerformerDataObject)

type MutationDataCache = BaseCache & {
    [cacheKey: string]: DataObject;
}

interface PerformerEntry {
    id: string | null;
    name: string;
    disambiguation?: string;
    appearance: string | null;
    notes?: string[];
    /** Only for remove/append */
    status?: string;
    /** Only for remove/append, with specific statuses */
    status_url?: string;
    /** Only for update */
    old_appearance?: string | null;
}

type FingerprintsColumnIndices = {
    algorithm: number;
    hash: number;
    duration: number;
    submissions: number;
}
