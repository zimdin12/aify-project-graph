#version 450 core

float clampPositive(float x) {
    return x < 0.0 ? 0.0 : x;
}

vec3 reflectAcross(vec3 v, vec3 n) {
    return v - 2.0 * dot(v, n) * n;
}
