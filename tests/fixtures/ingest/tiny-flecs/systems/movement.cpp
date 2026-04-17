#include <flecs.h>

struct Transform { float x, y, z; };
struct Velocity { float dx, dy, dz; };
struct PlayerTag {};

void registerMovementSystem(flecs::world& world) {
    world.system<Transform, Velocity, PlayerTag>()
        .each([](flecs::entity e, Transform& tf, Velocity& v, PlayerTag&) {
            tf.x += v.dx;
            tf.y += v.dy;
            tf.z += v.dz;
        });
}

void registerDamping(flecs::world& world) {
    world.query<Velocity>().each([](flecs::entity e, Velocity& v) {
        v.dx *= 0.9f;
        v.dy *= 0.9f;
        v.dz *= 0.9f;
    });
}
