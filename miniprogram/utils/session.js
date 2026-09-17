const FAMILY_SCOPED_KEYS = ["familyEduSelectedChildId", "familyEduLearningModule"];

function clearFamilyScopedCache(storage) {
  FAMILY_SCOPED_KEYS.forEach((key) => storage.removeStorageSync(key));
}

module.exports = { FAMILY_SCOPED_KEYS, clearFamilyScopedCache };
