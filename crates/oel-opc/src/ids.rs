//! Fresh ids for new parts and elements (sheet ids, slide ids, shape ids, part numbers).

use std::collections::BTreeSet;

/// Hands out ids that `used` doesn't hold, within `lo..=hi`: from just above the highest used one, as Office
/// does, then the lowest free ones once a file (a crafted one can) already holds the top of the range. Adding
/// one to the highest id would overflow there.
pub struct FreeIds {
    used: BTreeSet<u32>,
    next: u32,
    lo: u32,
    hi: u32,
}

impl FreeIds {
    pub fn new(used: impl IntoIterator<Item = u32>, lo: u32, hi: u32) -> Self {
        let used: BTreeSet<u32> = used.into_iter().collect();
        let next = used.last().map_or(lo, |m| m.saturating_add(1)).max(lo);
        FreeIds { used, next, lo, hi }
    }

    /// The next free id. Panics only when every id of the range is taken.
    pub fn take(&mut self) -> u32 {
        let mut id = self.next;
        if id > self.hi || self.used.contains(&id) {
            id = (self.lo..=self.hi).find(|i| !self.used.contains(i)).expect("an id range with room");
        }
        self.used.insert(id);
        self.next = id.saturating_add(1);
        id
    }
}

#[cfg(test)]
mod tests {
    use super::FreeIds;

    #[test]
    fn continues_above_the_highest() {
        let mut ids = FreeIds::new([3, 1, 7], 1, u32::MAX);
        assert_eq!((ids.take(), ids.take()), (8, 9));
        assert_eq!(FreeIds::new([], 256, 1000).take(), 256);
        assert_eq!(FreeIds::new([5], 256, 1000).take(), 256);
    }

    #[test]
    fn falls_back_to_free_ids_at_the_top() {
        let mut ids = FreeIds::new([1, 2, u32::MAX], 1, u32::MAX);
        assert_eq!((ids.take(), ids.take()), (3, 4));
        let mut slides = FreeIds::new([256, 2_147_483_647], 256, 2_147_483_647);
        assert_eq!((slides.take(), slides.take()), (257, 258));
        let mut full_top = FreeIds::new([u32::MAX - 1], 1, u32::MAX);
        assert_eq!((full_top.take(), full_top.take()), (u32::MAX, 1));
    }
}
