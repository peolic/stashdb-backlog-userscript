type AnyObject =
    | 'scenes'
    | 'performers'
    | 'studios'
    | 'tags'
    | 'categories'
    | 'edits'
    | 'users'
    | 'search'

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

interface BaseCache {
    contentHash?: string;
    lastUpdated?: string;
    lastChecked?: string;
}

interface DataIndex extends Omit<BaseCache, "contentHash"> {
    scenes: { [uuid: string]: string[]; };
    performers: { [uuid: string]: string[]; };
}

type MutationDataIndex = {
    scenes: { [uuid: string]: string };
    performers: { [uuid: string]: string };
}

interface SceneDataObject extends Omit<BaseCache, "lastChecked"> {
    title?: string;
    date?: string;
    duration?: string;
    performers?: {
        remove: PerformerEntry[];
        append: PerformerEntry[];
        update?: PerformerEntry[];
    };
    studio?: [string, string];
    url?: string;
    details?: string;
    director?: string;
    // tags?: string[];
    image?: string;
    fingerprints?: Array<{
        algorithm: string;
        hash: string;
        correct_scene_id: string | null;
    }>;
    comments?: string[];
}

interface PerformerDataObject extends Omit<BaseCache, "lastChecked"> {
    duplicates?: string[];
    duplicate_of: string;
}

interface DataCache {
    scenes: { [uuid: string]: SceneDataObject };
    performers: { [uuid: string]: PerformerDataObject };
}

type SupportedObject = keyof Omit<DataIndex, keyof BaseCache> & keyof DataCache

type DataObject = DataCache[SupportedObject][string]

type MutationDataCache = {
    [cacheKey: string]: DataObject;
}

interface PerformerEntry {
    id: string | null;
    name: string;
    disambiguation?: string;
    appearance: string | null;
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
