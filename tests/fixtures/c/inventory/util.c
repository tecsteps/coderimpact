#include "util.h"

long round_cents(double amount) {
    long whole = (long)(amount * 100.0 + 0.5);
    return whole;
}
