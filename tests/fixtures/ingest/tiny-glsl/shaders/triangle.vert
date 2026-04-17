#version 450 core
#include "common.glsl"

layout(binding = 0) uniform UBO {
    mat4 mvp;
} ubo;

layout(location = 0) in vec3 aPos;
layout(location = 0) out vec4 vColor;

struct Vertex {
    vec3 pos;
    vec3 normal;
};

float clampPositive(float x) {
    return max(x, 0.0);
}

void main() {
    vColor = vec4(clampPositive(aPos.x), 1.0, 1.0, 1.0);
    gl_Position = ubo.mvp * vec4(aPos, 1.0);
}
