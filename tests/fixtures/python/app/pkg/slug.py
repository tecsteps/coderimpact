class Slugger:
    def __init__(self, max_len):
        self.max_len = max_len

    def make(self, title):
        return normalize(title)[: self.max_len]


def normalize(s):
    return s.strip().lower().replace(" ", "-")
