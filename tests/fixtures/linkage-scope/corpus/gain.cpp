namespace {
int applyGain(int x) { return x * 3; }
}

using Handler = int (*)(int);

namespace {
Handler kHandlers[] = { applyGain };
}

int applyByIndex(int i, int x) { return kHandlers[i](x); }
