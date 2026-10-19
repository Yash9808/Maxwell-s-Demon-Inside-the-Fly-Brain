"""Single-threaded production-parity top-K scan (refreshWeightOverlay).

Split from kernels.py: this O(NE) serial while-loop kernel is benchmarked
separately and isolates the heap codegen from the hot kernels."""
import warp as wp

CHANGE_TOP_K = 180  # production changeLimit (fly_demon_3d.html brainHolder)


@wp.func
def heap_push(heap_v: wp.array(dtype=wp.float32), heap_i: wp.array(dtype=wp.int32),
              k: wp.int32, size_in: wp.int32, val: wp.float32, idx: wp.int32) -> wp.int32:
    """Sift-up min-heap push (mirrors refreshWeightOverlay bubbleUp/bubbleDown).

    Single-threaded: call from one warp thread over a chunk of edges."""
    size = wp.int32(size_in)          # args are immutable in Warp: copy to local
    if size < k:
        # insert at end, sift up
        pos = wp.int32(size)          # explicit dynamic variable
        heap_v[pos] = val
        heap_i[pos] = idx
        size = size + wp.int32(1)
        while pos > 0:
            parent = (pos - 1) // 2
            if heap_v[parent] <= heap_v[pos]:
                break
            tv = heap_v[parent]; heap_v[parent] = heap_v[pos]; heap_v[pos] = tv
            ti = heap_i[parent]; heap_i[parent] = heap_i[pos]; heap_i[pos] = ti
            pos = parent
    elif val > heap_v[0]:
        # replace root, sift down
        heap_v[0] = val
        heap_i[0] = idx
        pos = wp.int32(0)
        while True:
            left = pos * 2 + 1
            if left >= size:
                break
            child = left
            right = left + 1
            if (right < size) and (heap_v[right] < heap_v[left]):
                child = right
            if heap_v[child] >= heap_v[pos]:
                break
            tv = heap_v[pos]; heap_v[pos] = heap_v[child]; heap_v[child] = tv
            ti = heap_i[pos]; heap_i[pos] = heap_i[child]; heap_i[child] = ti
            pos = child
    return size


@wp.kernel
def k_topk_changes(
    changes: wp.array(dtype=wp.float32),
    heap_v: wp.array(dtype=wp.float32),
    heap_i: wp.array(dtype=wp.int32),
    k: wp.int32,
    ne: wp.int32,
):
    """Single-threaded top-K by sift-up (production parity, 563k-edge scan)."""
    if wp.tid() != 0:
        return
    size = wp.int32(0)
    for i in range(ne):
        size = heap_push(heap_v, heap_i, k, size, changes[i], i)




@wp.kernel
def k_topk_changes(
    changes: wp.array(dtype=wp.float32),
    heap_v: wp.array(dtype=wp.float32),
    heap_i: wp.array(dtype=wp.int32),
    k: wp.int32,
    ne: wp.int32,
):
    """Single-threaded top-K by sift-up (production parity, 563k-edge scan)."""
    if wp.tid() != 0:
        return
    size = wp.int32(0)
    for i in range(ne):
        size = heap_push(heap_v, heap_i, k, size, changes[i], i)
