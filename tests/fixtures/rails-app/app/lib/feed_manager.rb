class FeedManager
  def push_to_home(status_id)
    redis.zadd('feed:home', status_id, status_id)
  end

  def query(type, id, limit)
    redis.zrevrange("feed:#{type}:#{id}", 0, limit)
  end
end
